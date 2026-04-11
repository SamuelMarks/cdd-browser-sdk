async function run() {
  const { loadPyodide } = await import("pyodide");
  const pyodide = await loadPyodide();
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  try {
    await micropip.install("python-cdd-all");
    console.log("SUCCESS!");
  } catch(e) {
    console.error("FAIL", e.message);
  }
}
run();
