const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    items: [
        {
            _id: String,
            name: String,
            price: Number,
            qty: Number
        }
    ],
    total: Number,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Order", orderSchema);