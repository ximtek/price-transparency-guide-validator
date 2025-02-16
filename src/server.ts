import express from "express";
import cors from "cors";
import { validate } from "./commands";

const app = express();
app.use(cors());
app.use(express.json());

// API Endpoint to Validate JSON
app.post("/validate", async (req, res) => {
    const jsonInput = req.body.json;
    try {
        const result = await validate(jsonInput);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the Server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
