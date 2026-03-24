async function run() {
  const { loadPyodide } = await import("pyodide");
  const pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.0/full/" });
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  try {
    await micropip.install(["pydantic", "libcst", "urllib3", "python-cdd"]);
    console.log("Install successful!");
  } catch (e) {
    console.error(e);
  }
}
run();
