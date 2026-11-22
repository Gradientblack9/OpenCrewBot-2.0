export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startEngine } = await import("./lib/server/workforce/engine");
    await startEngine();
  }
}
