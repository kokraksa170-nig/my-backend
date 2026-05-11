require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log(err));

const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String
});
const Product = mongoose.model("Product", productSchema);

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items: Array,
  total: Number,
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model("Order", orderSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model("User", userSchema);

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token ❌" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret123");
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token ❌" });
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ message: "Admins only ❌" });
  next();
}

app.get("/", (req, res) => res.send("API is running 🚀"));

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields are required ❌" });
    if (password.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters ❌" });
    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "Email already registered ❌" });
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed });
    await user.save();
    res.json({ message: "Registered successfully ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "All fields are required ❌" });
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "User not found ❌" });
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Wrong password ❌" });
    const token = jwt.sign(
      { id: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET || "secret123",
      { expiresIn: "7d" }
    );
    res.json({ token, isAdmin: user.isAdmin, message: "Login successful ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/products", async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/products", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, price, image } = req.body;
    if (!name || !price || !image)
      return res.status(400).json({ message: "All fields are required ❌" });
    const newProduct = new Product({ name, price, image });
    await newProduct.save();
    res.json({ message: "Product added successfully ✅", product: newProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, price, image } = req.body;
    if (!name || !price || !image)
      return res.status(400).json({ message: "All fields are required ❌" });
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      { name, price, image },
      { new: true }
    );
    res.json({ message: "Product updated ✅", product: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/seed", async (req, res) => {
  await Product.deleteMany();
  await Product.insertMany([
    { name: "Running Shoes", price: 50, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff" },
    { name: "Casual Shirt", price: 25, image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab" },
    { name: "Luxury Watch", price: 100, image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa" }
  ]);
  res.send("Seeded ✅");
});

app.post("/orders", authMiddleware, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ message: "Cart is empty ❌" });
    const productIds = items.map(i => i._id);
    const dbProducts = await Product.find({ _id: { $in: productIds } });
    const verifiedItems = items.map(item => {
      const real = dbProducts.find(p => p._id.toString() === item._id);
      if (!real) throw new Error("Product not found");
      return { _id: item._id, name: real.name, price: real.price, qty: item.qty };
    });
    const total = verifiedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    const newOrder = new Order({ userId: req.user.id, items: verifiedItems, total });
    await newOrder.save();
    res.json({ message: "Order saved successfully ✅", order: newOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", authMiddleware, async (req, res) => {
  try {
    const query = req.user.isAdmin ? {} : { userId: req.user.id };
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(5000, () => console.log("Server running on port 5000 🚀"));