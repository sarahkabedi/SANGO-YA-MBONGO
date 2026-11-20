
const createApp = require("./app");
const pool = require("./db");
const app = createApp({ pool });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveur Sango Ya Mbongo lancé sur le port ${PORT}`);
});