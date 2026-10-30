import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const exited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean) => { clearTimeout(timer); child.removeListener("exit", onExit); resolve(value); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    if (exited(child)) finish(true);
  });
}

/** Fixtures are spawned in their own Unix process group; Windows uses taskkill /T. */
export async function stopFixtureProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || !child.pid || exited(child)) return;
  if (process.platform === "win32") {
    try { await exec("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 }); }
    catch { if (!exited(child)) throw new Error("Could not stop the fixture process tree."); }
  } else {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  if (await waitForExit(child, 5_000)) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    if (await waitForExit(child, 2_000)) return;
  }
  throw new Error("Fixture process did not exit within the cleanup deadline.");
}
