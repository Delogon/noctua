import { app } from 'electron'
import { arch, cpus, platform, release, totalmem } from 'node:os'

/** Versions- und Hardware-Angaben fürs Manifest — ohne Hostname, Nutzer oder Pfade. */
export function diagnosticsAppInfo(): Record<string, string | number | boolean | null> {
  const cpu = cpus()
  return {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron ?? null,
    chrome: process.versions.chrome ?? null,
    node: process.versions.node,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    cpuModel: cpu[0]?.model ?? null,
    cpuCount: cpu.length,
    totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10
  }
}
