// require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const invoiceRoutes = require("./routes/invoiceRoutes");
const { db } = require("./config/database");

const cors = require("cors"); // 👈 install: npm install cors
const app = express();

// Enable CORS for your dev HTML page
app.use(
  cors({
    origin: ["http://localhost:5172"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    // allowedHeaders: ["Content-Type", "Authorization"], // Ensure necessary headers are allowed
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(bodyParser.json());
app.use(cookieParser());

app.get("/", async (req, res) => {
  try {
    await db.query("SELECT 1");

    console.log("✅ Database connected successfully");

    res.json({
      success: true,
      message: "Sage 200 Evolution middleware is working",
      database: "connected",
    });
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);

    res.status(500).json({
      success: false,
      message: "Sage 200 Evolution middleware is working",
      database: "not connected",
      error: err.message,
    });
  }
});

app.get("/api/", (req, res) => {
  res.json({ message: "Sage 200 evolution middleware is working" });
});

app.use("/api", invoiceRoutes);

app.listen(3280, () => {
  console.log("Server running on port 3280");
});
