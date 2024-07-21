// import pyodide
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js");

// ref: https://gist.github.com/zenparsing/5dffde82d9acef19e43c
function dedent(callSite, ...args) {
  function format(str) {
    let size = -1;
    return str.replace(/\n(\s+)/g, (m, m1) => {
      if (size < 0) {
        size = m1.replace(/\t/g, "    ").length;
      }

      return "\n" + m1.slice(Math.min(m1.length, size));
    });
  }

  if (typeof callSite === "string") {
    return format(callSite);
  }

  if (typeof callSite === "function") {
    return (...args) => format(callSite(...args));
  }

  let output = callSite
    .slice(0, args.length + 1)
    .map((text, i) => (i === 0 ? "" : args[i - 1]) + text)
    .join("");

  return format(output);
}

/**
 * Initialize the pyodide VM
 * ref: https://pyodide.org/en/stable/usage/webworker.html
 * @param {*} data
 * @param {MessagePort} port
 */
async function initialize(data, port) {
  // load pyodide
  console.info("WORKER: loading pyodide...");
  self.pyodide = await loadPyodide();

  // load packages
  console.info("WORKER: loading packages...");
  await self.pyodide.loadPackage(["numpy", "pywavelets"]);

  // initialization script
  console.info("WORKER: importing modules...");
  await self.pyodide.runPythonAsync(dedent`
    import json
    import pywt
    import numpy as np
  `);

  // send OK
  port.postMessage(null);
  console.info("WORKER: ready!");
}

/**
 * Extract scalogram using CWT
 * @param {*} data
 * @param {MessagePort} port
 */
async function extractScalogram(data, port) {
  const { rt, values, mean, std } = data;

  // set variables
  // self.pyodide.globals.set("rt", rt);
  self.pyodide.globals.set("values", values);
  self.pyodide.globals.set("mean", mean);
  self.pyodide.globals.set("std", std);

  try {
    // run python code
    const rawOutput = await self.pyodide.runPythonAsync(dedent`
      # get signal
      signal = np.array(json.loads(values))

      # z-transform
      signal = (signal - mean) / std

      # extract wavelet features
      cA, cD = pywt.cwt(signal, range(1, 128), 'morl', 1)

      # clip the scalogram
      raw = cA[:, :127]

      # return
      raw.tolist()
		`);

    // get results
    const result = rawOutput.toJs();
    rawOutput.destroy();

    // send results back to main thread
    port.postMessage(result);
  } catch (error) {
    console.error("Error when extracting scalogram", error);

    // send error back to main thread
    port.postMessage({ error: error.message });
  }
}

/**
 * Handle message from main thread
 * @param {MessageEvent} event
 */
self.onmessage = async (event) => {
  // get func name and port
  const port = event.ports[0];
  const { func } = event.data;

  // run function
  switch (func) {
    case "initialize":
      await initialize(event.data, port);
      break;

    case "extractScalogram":
      await extractScalogram(event.data, port);
      break;

    default:
      console.error("Not implemented!", id, func);
      break;
  }

  // close port
  port.close();
};
