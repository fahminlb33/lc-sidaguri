// ===================================
//   AVAILABLE CLASSIFICATION MODELS
// ===================================

const MODELS = {
  sidaguri_duha: {
    name: "Sidaguri - Duha",
    classifierModel: "./assets/model/sidaguri_duha-classif-web/model.json",
    regressionModel: "./assets/model/sidaguri_duha-reg-web/model.json",
    classMap: {
      0: "Adulteration",
      1: "Sida rhombifolia",
      2: "Turnera subulata",
    },
  },
  kejibeling_sirih: {
    name: "Keji Beling - Sirih",
    classifierModel: "./assets/model/kejibeling_sirih-classif-web/model.json",
    regressionModel: "./assets/model/kejibeling_sirih-reg-web/model.json",
    classMap: {
      0: "Adulteration",
      1: "Strobilanthes crispa",
      2: "Piper aduncum",
    },
  },
};

// ===================================
//   ALPINE APP
// ===================================

document.addEventListener("alpine:init", () => {
  let chartContext = null;
  let classifierModel = null;
  let regressionModel = null;

  // alpine app
  Alpine.data("app", () => ({
    // --- states
    // input file
    fileName: "",
    // chromatogram
    rt: [],
    values: [],
    // prediction output
    prediction: {
      targetName: "",
      probability: "",
      concentration: "",
    },
    // UI
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

      // initialize ONNX model
      this.changeModel();
    },

    changeModel() {
      // set model empty
      classifierModel = null;
      regressionModel = null;

      // update UI
      this.checkReady();

      // load model async
      console.info("Initializing TensorFlow.js model...");
      tf.loadGraphModel(MODELS[this.selectedModel].classifierModel).then(model => {
        console.info("Classification model loaded!");

        // cache model
        classifierModel = model;

        // update UI
        this.checkReady();
      });

      tf.loadGraphModel(MODELS[this.selectedModel].regressionModel).then(model => {
        console.info("Regression model loaded!");

        // cache model
        regressionModel = model;

        // update UI
        this.checkReady();
      });
    },

    upload() {
      // check if file is available
      let file = this.$refs.datasetFile.files[0];
      if (!file) {
        Swal.fire({
          icon: "warning",
          title: "Upload failed",
          text: "File is not selected!",
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
              title: "Upload failed",
              text: "There's an error parsing the uploaded CSV file. Check browser's DevTools.",
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

          // run classification
          this.classify();
        },
      });
    },

    async classify() {
      // check if dataset is available
      if (this.rt.length === 0) {
        Swal.fire({
          icon: "error",
          title: "Prediction failed",
          text: "Dataset is not uploaded or empty!",
        });
        return;
      }

      // make UI disabled
      this.toggleUI(false);

      // run prediction
      const X = tf.expandDims(tf.expandDims(tf.tensor(this.values), axis=-1), axis=0);
      const predictedProbaClasses = await classifierModel.predict(X);
      console.log("predictedProbaClasses", predictedProbaClasses)

      // convert tensor to primitive types
      const predictedTarget = await tf.argMax(predictedProbaClasses, axis=1).dataSync();
      const predictedProba = await predictedProbaClasses.dataSync();

      // set prediction result
      this.prediction.targetName = MODELS[this.selectedModel].classMap[predictedTarget[0]];
      this.prediction.probability = (predictedProba[predictedTarget[0]] * 100).toFixed(4);

      // check if we need to run the regression model
      if (predictedTarget[0] === 0) {
        // run prediction for regression model
        const regPredicted = await regressionModel.predict(X);

        // convert to primitive
        const predictedAdulterationPercent = await regPredicted.dataSync();
        console.log("predictedAdulterationPercent", predictedAdulterationPercent)

        // set prediction result
        this.prediction.concentration = predictedAdulterationPercent[0].toFixed(4) + "%";
      } else {
        this.prediction.concentration = "No adulteration!"
      }
      
      // make UI available
      this.toggleUI(true);
    },

    clear() {
      // clear input file
      this.fileName = "";
      this.$refs.datasetFile.value = null;

      // clear chromatogram
      this.rt = [];
      this.values = [];
      this.renderChromatogram();

      // clear prediction
      this.prediction = {
        targetName: "",
        probability: "",
        concentration: "",
      }
    },

    renderChromatogram() {
      // get the canvas
      const chromatogramElement = document.getElementById("chromatogram");

      // if there is a last canvas context, destroy it
      if (chartContext) {
        chartContext.destroy();
      }

      // render the new canvas
      chartContext = new Chart(chromatogramElement, {
        type: "line",
        data: {
          labels: this.rt,
          datasets: [
            {
              label: "Intensity",
              data: this.values,
              borderWidth: 1,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
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
      this.ready = classifierModel != null && regressionModel != null;
      this.controlsDisabled = !this.ready;
    },

    toggleUI(enable) {
      this.controlsDisabled = !enable;
    },
  }));

  // ---- END
});
