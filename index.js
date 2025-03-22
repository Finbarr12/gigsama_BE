const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const { nanoid } = require("nanoid");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // Gemini AI import

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Check for required environment variables
const requiredEnvVars = ["GEMINI_API_KEY", "MONGODB_URI"]; // Updated to GEMINI_API_KEY
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(
    "ERROR: The following required environment variables are missing:"
  );
  missingEnvVars.forEach((envVar) => console.error(`- ${envVar}`));
  console.error("Please set these variables in your .env file");
}

// MongoDB connection
let client;
let db;

async function connectToMongoDB() {
  try {
    if (!process.env.MONGODB_URI) {
      console.error("ERROR: MONGODB_URI environment variable is not set");
      return;
    }

    client = new MongoClient(
      process.env.MONGODB_URI ||
        "mongodb+srv://FinbarrDB:codelab06@cluster0.2xzneqt.mongodb.net/gigsama?retryWrites=true&w=majority&appName=Cluster0"
    );
    await client.connect();
    db = client.db(process.env.MONGODB_DB_NAME || "schema_designer");
    console.log("Connected to MongoDB successfully");

    // Create indexes if needed
    await db.collection("projects").createIndex({ id: 1 }, { unique: true });

    return true;
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    return false;
  }
}

// Gemini AI configuration
let genAI;
if (!process.env.GEMINI_API_KEY) {
  console.error("ERROR: GEMINI_API_KEY environment variable is not set");
  console.error("Please set your Gemini API key in the .env file");
} else {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("Gemini AI client initialized");
  } catch (error) {
    console.error("Error initializing Gemini AI client:", error);
  }
}

// Status endpoint to check configuration
app.get("/api/status", async (req, res) => {
  const status = {
    server: true,
    gemini: !!process.env.GEMINI_API_KEY, // Updated to GEMINI_API_KEY
    database: false,
  };

  // Check database connection
  if (db) {
    try {
      const dbResult = await db.command({ ping: 1 });
      status.database = !!dbResult;
    } catch (error) {
      console.error("Database connection test failed:", error);
    }
  }

  res.json(status);
});

// API Routes
// Chat endpoint
app.post("/api/chat", async (req, res) => {
  // Check if Gemini API key is configured
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error:
        "Gemini API key is missing. Please set the GEMINI_API_KEY environment variable.",
    });
  }

  // Check if Gemini client is initialized
  if (!genAI) {
    return res.status(500).json({
      error: "Gemini client is not initialized. Please check your API key.",
    });
  }

  try {
    const { messages } = req.body;

    // Check if we need to generate a schema
    const userMessages = messages.filter((m) => m.role === "user");
    const shouldGenerateSchema = userMessages.length >= 3;

    let systemPrompt = `You are a helpful database design assistant. Help the user design their MongoDB database schema by asking relevant questions about their project requirements.
Focus on understanding:
- The purpose of the database
- The main collections needed
- The document structure for each collection
- Relationships between collections
- Any specific indexes or constraints needed

Ask one question at a time and wait for the user's response before proceeding to the next question.`;

    if (shouldGenerateSchema) {
      systemPrompt = `You are a helpful MongoDB database design assistant. Based on the conversation so far, generate a complete MongoDB schema.

Generate a MongoDB schema using JSON format showing the structure of documents and collections. Include:
1. Collection definitions
2. Sample documents with proper field types
3. Suggested indexes
4. Embedding vs referencing recommendations for relationships

Explain your design decisions based on MongoDB best practices and the requirements.
Format the schema in a code block using triple backticks with json as the language.`;
    }

    // Initialize the Gemini model
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Combine system prompt and user messages
    const combinedMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    // Convert messages to a single prompt string
    const prompt = combinedMessages
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    // Generate response
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      content: text,
      role: "assistant",
    });
  } catch (error) {
    console.error("Error generating response:", error);
    res.status(500).json({
      error: error.message || "An error occurred while generating the response",
    });
  }
});

// Get project by ID
app.get("/api/projects/:id", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "Database connection not available" });
  }

  try {
    const { id } = req.params;
    const project = await db.collection("projects").findOne({ id });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({
      id: project.id,
      name: project.name,
      schema: project.schema,
      schemaType: project.schemaType,
      conversation: project.conversation,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Create new project
app.post("/api/projects", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "Database connection not available" });
  }

  try {
    const { name, schema, schemaType, conversation } = req.body;
    const id = nanoid();
    const now = new Date();

    const project = {
      id,
      name,
      schema,
      schemaType,
      conversation,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("projects").insertOne(project);

    res.status(201).json({ id });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

// Update project
app.put("/api/projects/:id", async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: "Database connection not available" });
  }

  try {
    const { id } = req.params;
    const { name, schema } = req.body;
    const now = new Date();

    const result = await db.collection("projects").updateOne(
      { id },
      {
        $set: {
          name,
          schema,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

// Initialize server
async function startServer() {
  // Connect to MongoDB
  const isConnected = await connectToMongoDB();

  // Start server
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(
      `Gemini API Key: ${process.env.GEMINI_API_KEY ? "Configured" : "Missing"}`
    );
    console.log(
      `MongoDB URI: ${process.env.MONGODB_URI ? "Configured" : "Missing"}`
    );
    console.log(`MongoDB Connection: ${isConnected ? "Successful" : "Failed"}`);
  });
}

startServer();
