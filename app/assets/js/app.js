const MODELS = {
  sidaguri_duha: {
    name: "Sidaguri - Duha",
    // path: "./assets/model/sidaguri-duha/model.json",
    path: "https://blob.kodesiana.com/kodesiana-ai-public/models/lc-sidaguri/js_lcms_classif_sidaguri_duha/model.json",
    mean: 30488685.23260185,
    std: 78338321.0455869,
    class_map: {
      0: "Campuran 5%",
      1: "Campuran 25%",
      2: "Campuran 50%",
      3: "Sidaguri",
      4: "Duha",
    },
  },
  kejibeling_sirih: {
    name: "Keji Beling - Sirih",
    // path: "./assets/model/keji_beling-sirih/model.json",
    path: "https://blob.kodesiana.com/kodesiana-ai-public/models/lc-sidaguri/js_lcms_classif_kejibeling_sirih/model.json",
    mean: 43877836.5496915,
    std: 104778972.11904727,
    class_map: {
      0: "Campuran 5%",
      1: "Campuran 25%",
      2: "Campuran 50%",
      3: "Keji Beling",
      4: "Sirih Hutan",
    },
  },
};

document.addEventListener("alpine:init", () => {
  let tfmodel = null;
  let worker = null;
  let lastCanvasContext = null;
  let counter = 0;
  let pyodideReady = false;
  const resolvers = new Map();
  const rejectors = new Map();

  // ===================================
  //   ALPINE APP
  // ===================================

  Alpine.data("app", () => ({
    // states
    rt: [],
    values: [],
    results: [],
    fileName: "",
    ready: false,
    controlsDisabled: true,
    selectedModel: "sidaguri_duha",
    availabeModels: Object.entries(MODELS).map(([k, v]) => ({
      value: k,
      name: v.name,
    })),

    // methods
    init() {
      // reset UI
      this.clear();

      // initialize tensorflow model
      this.changeModel();

      // initialize pyodide
      console.info("Initializing Pyodide VM...");
      worker = new Worker("./assets/js/worker.js");
      worker.onmessage = (event) => {
        // check if the worker is ready
        if (event.data.id === "pyodideReady") {
          pyodideReady = true;
          this.checkReady();
          return;
        }

        // get the resolve and reject functions
        const resolve = resolvers.get(event.data.id);
        const reject = rejectors.get(event.data.id);

        // if the resolve function is not found, ignore the message
        if (resolve) {
          // if the message contains an error, reject the promise
          if (event.data.error !== undefined) {
            reject(new Error(event.data.error));
          } else {
            // resolve the promise
            if (event.data.runner === "extractScalogram") {
              resolve(event.data.result);
            } else {
              reject(new Error("Not implemented!"));
            }
          }

          resolvers.delete(event.data.id);
          rejectors.delete(event.data.id);
        }
      };
    },

    changeModel() {
      // set model empty
      tfmodel = null;

      // update UI
      this.checkReady();

      // load model async
      console.info("Initializing TensorFlow model...");
      tf.loadGraphModel(MODELS[this.selectedModel].path).then((model) => {
        console.info("Model loaded!");

        // cache model
        tfmodel = model;

        // update UI
        this.checkReady();
      });
    },

    uploadDataset() {
      // check if file is available
      let file = this.$refs.datasetFile.files[0];
      if (!file) {
        Swal.fire({
          icon: "warning",
          title: "Gagal Unggah",
          text: "Berkas belum dipilih!",
        });
        return;
      }

      // update name
      this.fileName = file.name;

      // make UI disabled
      this.toggleUI(false);

      // parse the data
      Papa.parse(file, {
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          // check for errors
          if (results.errors.length > 0) {
            // make UI available
            this.toggleUI(true);

            // show message
            console.error("Error when parsing CSV", results.errors);
            Swal.fire({
              icon: "error",
              title: "Gagal Unggah",
              text: "Terjadi kesalahan ketika mengunggah data! Lihat error pada Console.",
            });
            return;
          }

          // empty out the arrays
          this.rt = [];
          this.values = [];

          // push the data
          for (const item of results.data) {
            // remove header, if any
            const RT = parseFloat(item[0]);
            if (isNaN(RT)) {
              continue;
            }

            // push data
            this.rt.push(RT);
            this.values.push(parseFloat(item[1]));
          }

          // show plot
          this.renderChromatogram();

          // make UI available
          this.toggleUI(true);

          // show message
          Swal.fire({
            icon: "success",
            title: "Berhasil Unggah",
            text: `Berhasil mengunggah dataset! ${this.rt.length} data diunggah.`,
          });
        },
      });
    },

    async extractScalogram() {
      // check if dataset is available
      if (this.rt.length === 0) {
        Swal.fire({
          icon: "error",
          title: "Gagal Prediksi",
          text: "Dataset belum diunggah!",
        });
        return;
      }

      // make UI disabled
      this.toggleUI(false);

      // increment the counter and create a promise
      const id = `${++counter}`;
      const result = await new Promise((resolve, reject) => {
        resolvers.set(id, resolve);
        rejectors.set(id, reject);
        // send the message to the worker
        worker.postMessage({
          runner: "extractScalogram",
          id,
          rt: JSON.stringify(this.rt),
          values: JSON.stringify(this.values),
          mean: MODELS[this.selectedModel].mean,
          std: MODELS[this.selectedModel].std,
        });
      });

      // get the extracted features from worker
      const img = tf.tensor(result);

      // (1) run classification
      const imgPredict = tf.expandDims(tf.expandDims(img, -1), 0);
      const prediction = tfmodel.predict(imgPredict);
      const predictedClass = prediction.argMax(-1).dataSync()[0];

      // create results
      this.results = [];
      const predictionsArr = prediction.dataSync();
      for (let i = 0; i < predictionsArr.length; i++) {
        this.results.push({
          probability: (predictionsArr[i] * 100).toFixed(2),
          targetName: MODELS[this.selectedModel].class_map[i],
          isTarget: i == predictedClass,
        });
      }

      // (2) min-max transform for visualization
      const min = tf.min(img);
      const max = tf.max(img);
      const imgNorm = img.sub(min).div(max.sub(min));
      tf.browser.toPixels(imgNorm, document.getElementById("scalogram"));

      // make UI available
      this.toggleUI(true);
    },

    clear() {
      // set empty
      this.rt = [];
      this.values = [];
      this.results = [];
      this.fileName = "";

      // clear chromatogram
      this.renderChromatogram();

      // clear scalogram
      const canvas = document.getElementById("scalogram");
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);

      // clear input file
      this.$refs.datasetFile.value = null;
    },

    renderChromatogram() {
      // get the canvas
      const chromatogramElement = document.getElementById("chromatogram");

      // if there is a last canvas context, destroy it
      if (lastCanvasContext) {
        lastCanvasContext.destroy();
      }

      // render the new canvas
      lastCanvasContext = new Chart(chromatogramElement, {
        type: "line",
        data: {
          labels: this.rt,
          datasets: [
            {
              label: "Intensity",
              data: this.values,
              borderWidth: 1,
            },
          ],
        },
        options: {
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Intensity",
              },
            },
            x: {
              title: {
                display: true,
                text: "Retention Time (s)",
              },
              ticks: {
                callback: function (value, index, ticks) {
                  return value.toFixed(2);
                },
              },
            },
          },
          plugins: {
            legend: {
              display: false,
            },
          },
        },
      });
    },

    // ===================================
    //   HELPERS
    // ===================================

    checkReady() {
      this.ready = pyodideReady && tfmodel != null;
      this.controlsDisabled = !this.ready;
    },

    toggleUI(enable) {
      this.controlsDisabled = !enable;
    },
  }));

  // ---- END
});
