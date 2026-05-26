const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = process.env.DB_NAME || "inventory";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "products";

let cachedClient = null;

async function getClient() {
  if (!MONGO_URI) {
    throw new Error("Missing MONGO_URI");
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI);
    await cachedClient.connect();
  }

  return cachedClient;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const client = await getClient();
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);
    const result = await collection.deleteMany({});

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).json({ deletedCount: result.deletedCount || 0 });
  } catch (error) {
    res.status(500).send(`Clear failed: ${error.message}`);
  }
};
