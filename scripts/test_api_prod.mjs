import 'dotenv/config';
import jwt from 'jsonwebtoken';

const BACKEND = 'https://mail-onedrive-org-graph.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-testing'; // They might have a different secret on Render! Wait!

// The easiest way is to use Playwright with a BIG timeout.
