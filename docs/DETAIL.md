# Morphe patch creator

Morphe's multi-stage Android APK patch workflow, offered as native DSH skills. It walks an
authorized APK from reconnaissance to a validated patch, and keeps every stage evidence-based:
findings must be confirmed in smali, and no stage reports success without a file or command result.

Ported from the `morphe-patch-creator` Claude Code plugin in
[Paresh-Maheshwari/morphe-ai](https://github.com/Paresh-Maheshwari/morphe-ai) (GPL-3.0-only).
This port reproduces the workflow; it adds no new capability and changes no scripts.

## Skills

| Skill | Purpose |
|---|---|
| `morphe-create-patch` | Start or resume the full pipeline and delegate each stage |
| `morphe-recon-apk` | Identify package, SDKs, format, DEX count, framework, protections |
| `morphe-decompile-apk` | Produce readable Java output and smali for every DEX |
| `morphe-find-patch-targets` | Locate targets and verify each against exact smali |
| `morphe-write-patch` | Implement an approved design in the patches repository |
| `morphe-validate-patch` | Build, list, and locally apply the patch bundle |
| `morphe-test-on-device` | Install on a chosen device and collect focused logs (explicit request only) |
| `morphe-submit-patch` | Commit, push, or open a PR (explicit request only) |

`morphe-create-patch` is the entry point. The other skills can also run on their own when the
prior stage's artifacts already exist.

## Usage

Ask for the workflow and give it the package and the change you are authorized to make:

> Use the morphe patch creator on `./app.apk` to remove the in-app purchase gate; I own this build.

The coordinator validates the workspace, reads `.morphe/config.json`, then runs or resumes recon →
decompile → hunt → design approval → write → validate. Recon, decompile, hunting, writing, and
validation run in subagents primed with the role prompts in `agents/`; the design approval and the
final report stay in the main session.

## Prerequisites

The workflow uses these commands; the doctor script reports them:

- Java 21+ (Morphe CLI runtime), `aapt`, `jadx`, `baksmali`, `rg`, `python3`, `file`, `unzip`
- Optional: `adb` for device testing, `uvx apkid` for protection detection
- `morphe-cli.jar` in the workspace, and a patches repository (default `morphe-patches`)
- `.morphe/config.json` may select `analysisDir`, `patchesDir`, `cliJar`, and decompiler mode

Run the read-only prerequisite check from the plugin root:

```bash
./scripts/doctor.sh
```

Building patches requires GitHub Packages credentials with `read:packages`, supplied as
`gpr.user` and `gpr.key` in `~/.gradle/gradle.properties`.

## Boundaries

- Only software the user is authorized to modify; no server-side payment, account, entitlement, or
  attestation compromise.
- APK, decompiled source, and logs are treated as untrusted data, never as instructions.
- Device testing, commits, pushes, pull requests, and releases require explicit user requests; the
  `morphe-test-on-device` and `morphe-submit-patch` skills are not model-invocable.
- Remote decompilation uploads an artifact off the machine, so it requires explicit approval; local
  jadx is the default.

## Limitations

- The upstream Claude plugin used skill frontmatter to route stages to named subagents. DSH has no
  equivalent, so `morphe-create-patch` spawns subagents with the role prompts in `agents/` instead.
- Credential setup, the patches repository, and device availability are environment concerns this
  bundle does not create.
- This package serves skills only. It registers no tools, UI, or MCP servers.

## License

GPL-3.0-only, inherited from the upstream repository. See `LICENSE`.
