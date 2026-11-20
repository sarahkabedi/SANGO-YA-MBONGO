const express = require("express");
const createCatalogController = require("../controllers/catalogController");

function createCatalogRouter(pool) {
  const router = express.Router();
  const controller = createCatalogController(pool);

  router.get("/sources", controller.getSources);
  router.get("/categories", controller.getCategories);
  router.get("/articles", controller.getArticles);
  router.get("/articles/:id", controller.getArticle);
  router.get("/indicators", controller.getIndicators);
  router.get("/indicators/:id", controller.getIndicator);

  return router;
}

module.exports = createCatalogRouter;
