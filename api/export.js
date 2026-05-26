const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "";
const DB_NAME = process.env.DB_NAME || "inventory";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "products";
const CSV_FIELDS = process.env.CSV_FIELDS || "ProductKey";

let cachedClient = null;

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseFields(fieldsInput) {
  const fields = fieldsInput
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  return Array.from(new Set(fields));
}

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
  try {
    const fields = parseFields(req.query.fields || CSV_FIELDS);
    if (fields.length === 0) {
      res.status(400).send("No CSV fields provided.");
      return;
    }

    const client = await getClient();
    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);
    const projection = fields.reduce((acc, field) => {
      acc[field] = 1;
      return acc;
    }, { _id: 0 });

    const cursor = collection.find({}, { projection });
    const rows = [fields.join(",")];

    await cursor.forEach((doc) => {
      const row = fields.map((field) => csvEscape(doc[field]));
      rows.push(row.join(","));
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=inventory-export.csv");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(rows.join("\n"));
  } catch (error) {
    res.status(500).send(`Export failed: ${error.message}`);
  }
};
