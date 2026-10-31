// Wall-clock and CPU time for the run log. CPU time is an estimate, since other
// calls can share a Fluid compute instance (plan 7).
export function startMeter() {
  const startedAt = Date.now();
  const cpuStart = process.cpuUsage();
  return () => {
    const cpu = process.cpuUsage(cpuStart);
    return { durationMs: Date.now() - startedAt, cpuMs: Math.round((cpu.user + cpu.system) / 1000) };
  };
}
