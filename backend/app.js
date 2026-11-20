const express = require("express");
const path = require("node:path");
const createCatalogRouter = require("./routes/catalogRoutes");

function createApp(options = {}) {
  const pool = options.pool || require("./db");
  const app = express();
  const frontendPath = path.join(__dirname, "..", "frontend");

  app.use(express.json());

  app.get("/", (req, res) => {
    const accept = req.get("accept") || "";
    if (!accept.includes("application/json") || accept.includes("text/html")) {
      res.sendFile(path.join(frontendPath, "index.html"));
    } else {
      res.json({
        message: "Bienvenue sur l'API Sango Ya Mbongo",
        status: "API opérationnelle",
      });
    }
  });

  app.use(express.static(frontendPath));

  app.get("/api/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({
        api: "OK",
        database: "Connected",
      });
    } catch (error) {
      res.status(500).json({
        api: "OK",
        database: "Disconnected",
      });
    }
  });

  app.use("/api", createCatalogRouter(pool));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: "NOT_FOUND", message: "Route introuvable." },
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error.status === 400 || error.type === "entity.parse.failed") {
      res.status(400).json({
        error: { code: "INVALID_REQUEST", message: "La requête est invalide." },
      });
      return;
    }

    console.error("Échec du traitement de la requête API", {
      code: error.code || "INTERNAL_ERROR",
    });
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Une erreur interne est survenue." },
    });
  });

  return app;
}

module.exports = createApp;
