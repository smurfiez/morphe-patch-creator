/**
 * morphe-patch-creator — Morphe's Android APK patch workflow as native DSH skills.
 *
 * Registers one SkillProvider (rank 550, below the filesystem providers, above
 * other bundled providers) that serves each `skills/<name>/SKILL.md` in this
 * package. Frontmatter supplies name, description and invocation policy; the
 * body is read lazily on invocation.
 *
 * Every skill declares this package root as its resource base, so the scripts,
 * references and role prompts shared by the workflow resolve relative to one
 * place instead of being duplicated per skill.
 *
 * Upstream: https://github.com/Paresh-Maheshwari/morphe-ai (GPL-3.0-only).
 * This port only reformats the workflow for DSH; it adds no new capability.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'morphe-patch-creator'
export const inject = ['skills']

/** Same tier as other third-party skill providers: project/user skills win. */
const PROVIDER_RANK = 550
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/**
 * Parse the small frontmatter subset these skills use: one `key: value` per
 * line. Values keep everything after the first colon, so descriptions may
 * contain colons.
 */
export function parseFrontmatter(raw) {
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const lines = raw.split('\n')
  if (lines[0]?.replace(/\r$/, '') !== '---') return undefined
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].replace(/\r$/, '') === '---') {
      end = i
      break
    }
  }
  if (end < 0) return undefined
  const data = {}
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed)
    if (!match) continue
    data[match[1]] = unquote(match[2].trim())
  }
  return { data, body: lines.slice(end + 1).join('\n') }
}

function text(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function flag(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  const normalized = String(value).toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(normalized)) return true
  if (['false', 'no', 'off', '0'].includes(normalized)) return false
  return undefined
}

function invocationPolicy(data) {
  return {
    modelInvocable: flag(data, 'disable-model-invocation') !== true,
    userInvocable: flag(data, 'user-invocable') !== false,
  }
}

export class MorpheSkillProvider {
  constructor(ctx, _control, config = {}) {
    this.ctx = ctx
    this.name = config.providerName ?? 'morphe'
    this.skillDir = resolve(ROOT, 'skills')
  }

  /** @returns {Promise<object[]>} */
  async list(options = {}) {
    options.signal?.throwIfAborted()
    let entries
    try {
      entries = await readdir(this.skillDir, { withFileTypes: true })
    } catch (error) {
      this.ctx.logger?.warn(`[morphe] skills directory unreadable: ${this.skillDir}`)
      return []
    }

    const candidates = []
    const seen = new Set()
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      options.signal?.throwIfAborted()
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const skillPath = join(this.skillDir, entry.name, 'SKILL.md')
      try {
        await stat(skillPath)
      } catch {
        this.ctx.logger?.debug?.(`[morphe] skip ${entry.name}: no SKILL.md`)
        continue
      }

      let parsed
      try {
        parsed = parseFrontmatter(await readFile(skillPath, 'utf8'))
      } catch (error) {
        this.ctx.logger?.warn(`[morphe] skip ${entry.name}: ${String(error)}`)
        continue
      }
      if (!parsed) {
        this.ctx.logger?.warn(`[morphe] skip ${entry.name}: missing frontmatter`)
        continue
      }

      const skillName = text(parsed.data, 'name')
      const description = text(parsed.data, 'description')
      if (!skillName || !description) {
        this.ctx.logger?.warn(`[morphe] skip ${entry.name}: needs name and description`)
        continue
      }
      if (!SKILL_NAME.test(skillName)) {
        this.ctx.logger?.warn(`[morphe] skip ${entry.name}: invalid skill name "${skillName}"`)
        continue
      }
      if (seen.has(skillName)) {
        this.ctx.logger?.warn(`[morphe] skip ${entry.name}: duplicate "${skillName}"`)
        continue
      }
      seen.add(skillName)

      const whenToUse = text(parsed.data, 'whenToUse')
      candidates.push({
        name: skillName,
        description,
        ...(whenToUse ? { whenToUse } : {}),
        invocation: invocationPolicy(parsed.data),
        source: 'bundled',
        provider: this.name,
        rank: PROVIDER_RANK,
        locator: { path: skillPath, directory: ROOT },
        resourceBase: { kind: 'directory', path: ROOT },
        path: skillPath,
      })
    }
    return candidates
  }

  /** @returns {Promise<object | undefined>} */
  async get(candidate, options = {}) {
    options.signal?.throwIfAborted()
    const locator = candidate?.locator
    if (!locator?.path) return undefined

    let raw
    try {
      raw = await readFile(locator.path, 'utf8')
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      this.ctx.logger?.warn(`[morphe] get ${candidate.name}: ${String(error)}`)
      return undefined
    }

    options.signal?.throwIfAborted()
    const parsed = parseFrontmatter(raw)
    if (!parsed) {
      this.ctx.logger?.warn(`[morphe] get ${candidate.name}: missing frontmatter`)
      return undefined
    }
    const skillName = text(parsed.data, 'name')
    const description = text(parsed.data, 'description')
    if (!skillName || !description || skillName !== candidate.name) {
      this.ctx.logger?.warn(`[morphe] get ${candidate.name}: identity drift`)
      return undefined
    }

    const whenToUse = text(parsed.data, 'whenToUse')
    return {
      name: skillName,
      description,
      ...(whenToUse ? { whenToUse } : {}),
      invocation: invocationPolicy(parsed.data),
      source: 'bundled',
      provider: this.name,
      resourceBase: { kind: 'directory', path: ROOT },
      path: locator.path,
      content: parsed.body.trim(),
    }
  }
}

export function apply(ctx, config = {}) {
  ctx.logger?.info('[morphe] registering Morphe patch workflow skills')
  ctx.effect(() => {
    const dispose = ctx.skills.registerProvider(
      (control) => new MorpheSkillProvider(ctx, control, config),
    )
    return () => dispose()
  })
}

export default { name, inject, apply }
