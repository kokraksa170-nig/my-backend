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

/* =======================
   MODELS
======================= */
const productSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String,
  category: { type: String, default: "General" },
  description: { type: String, default: "" },
  stock: { type: Number, default: 10 },
  ratings: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      stars: { type: Number, min: 1, max: 5 },
      comment: String,
      createdAt: { type: Date, default: Date.now }
    }
  ]
});

// ✅ Virtual average rating
productSchema.virtual("avgRating").get(function () {
  if (!this.ratings.length) return 0;
  return this.ratings.reduce((sum, r) => sum + r.stars, 0) / this.ratings.length;
});

productSchema.set("toJSON", { virtuals: true });

const Product = mongoose.model("Product", productSchema);

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items: Array,
  total: Number,
  status: { type: String, default: "pending" },
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

/* =======================
   MIDDLEWARE
======================= */
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

/* =======================
   ROOT
======================= */
app.get("/", (req, res) => res.send("API is running 🚀"));

/* =======================
   AUTH
======================= */
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
      { id: user._id, email: user.email, isAdmin: user.isAdmin, name: user.name },
      process.env.JWT_SECRET || "secret123",
      { expiresIn: "7d" }
    );
    res.json({ token, isAdmin: user.isAdmin, name: user.name, message: "Login successful ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   PRODUCTS
======================= */
app.get("/products", async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found ❌" });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/products", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, price, image, category, description, stock } = req.body;
    if (!name || !price || !image)
      return res.status(400).json({ message: "All fields are required ❌" });
    const newProduct = new Product({ name, price, image, category: category || "General", description: description || "", stock: stock || 10 });
    await newProduct.save();
    res.json({ message: "Product added successfully ✅", product: newProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/products/:id", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { name, price, image, category, description, stock } = req.body;
    if (!name || !price || !image)
      return res.status(400).json({ message: "All fields are required ❌" });
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      { name, price, image, category: category || "General", description: description || "", stock: stock || 0 },
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

// ✅ Add rating
app.post("/products/:id/rating", authMiddleware, async (req, res) => {
  try {
    const { stars, comment } = req.body;
    if (!stars || stars < 1 || stars > 5)
      return res.status(400).json({ message: "Stars must be 1-5 ❌" });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found ❌" });

    // Check if user already rated
    const existing = product.ratings.find(r => r.userId.toString() === req.user.id);
    if (existing) {
      existing.stars = stars;
      existing.comment = comment;
    } else {
      product.ratings.push({ userId: req.user.id, stars, comment });
    }

    await product.save();
    res.json({ message: "Rating submitted ✅", product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   SEED
======================= */
app.get("/seed", async (req, res) => {
  await Product.deleteMany();
  await Product.insertMany([
    {
      name: "Running Shoes",
      price: 50,
      image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
      category: "Shoes",
      description: "High-performance running shoes with superior cushioning and breathable mesh upper. Perfect for daily runs and marathon training.",
      stock: 15
    },
    {
      name: "Casual Shirt",
      price: 25,
      image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab",
      category: "Clothing",
      description: "Classic casual shirt made from 100% premium cotton. Comfortable fit perfect for everyday wear.",
      stock: 30
    },
    {
      name: "Luxury Watch",
      price: 100,
      image: "https://images.unsplash.com/photo-1548036328-c9fa89d128fa",
      category: "Accessories",
      description: "Elegant luxury timepiece with sapphire crystal glass and stainless steel bracelet. Water resistant up to 50 meters.",
      stock: 5
    }
  ]);
  res.send("Seeded ✅");
});

/* =======================
   ORDERS
======================= */
app.post("/orders", authMiddleware, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ message: "Cart is empty ❌" });
    const productIds = items.map(i => i._id);
    const dbProducts = await Product.find({ _id: { $in: productIds } });
    for (const item of items) {
      const real = dbProducts.find(p => p._id.toString() === item._id);
      if (!real) return res.status(400).json({ message: "Product not found ❌" });
      if (real.stock < item.qty) return res.status(400).json({ message: `Not enough stock for ${real.name} ❌` });
    }
    const verifiedItems = items.map(item => {
      const real = dbProducts.find(p => p._id.toString() === item._id);
      return { _id: item._id, name: real.name, price: real.price, qty: item.qty };
    });
    const total = verifiedItems.reduce((sum, item) => sum + item.price * item.qty, 0);
    for (const item of verifiedItems) {
      await Product.findByIdAndUpdate(item._id, { $inc: { stock: -item.qty } });
    }
    const newOrder = new Order({ userId: req.user.id, items: verifiedItems, total, status: "pending" });
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

app.put("/orders/:id/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["pending", "shipped", "delivered"];
    if (!validStatuses.includes(status))
      return res.status(400).json({ message: "Invalid status ❌" });
    const updated = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json({ message: "Order status updated ✅", order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   ANALYTICS (admin only)
======================= */
app.get("/analytics", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const orders = await Order.find();
    const products = await Product.find();
    const users = await User.find();

    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const totalOrders = orders.length;
    const totalProducts = products.length;
    const totalUsers = users.length;

    // Orders by status
    const statusCounts = { pending: 0, shipped: 0, delivered: 0 };
    orders.forEach(o => { if (statusCounts[o.status] !== undefined) statusCounts[o.status]++; });

    // Top products by revenue
    const productRevenue = {};
    orders.forEach(order => {
      order.items.forEach(item => {
        if (!productRevenue[item.name]) productRevenue[item.name] = 0;
        productRevenue[item.name] += item.price * item.qty;
      });
    });

    const topProducts = Object.entries(productRevenue)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, revenue]) => ({ name, revenue }));

    // Revenue by day (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayRevenue = orders
        .filter(o => new Date(o.createdAt).toDateString() === date.toDateString())
        .reduce((sum, o) => sum + o.total, 0);
      last7Days.push({ date: dateStr, revenue: dayRevenue });
    }

    res.json({ totalRevenue, totalOrders, totalProducts, totalUsers, statusCounts, topProducts, last7Days });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =======================
   START SERVER
======================= */
app.listen(5000, () => console.log("Server running on port 5000 🚀"));