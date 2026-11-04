const { Server } = require("socket.io");

let io;

const attachRealtime = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  return io;
};

const emitProductUpdate = (product) => {
  if (!io || !product) return;
  io.emit("product:updated", {
    id: String(product._id || product.id),
    currentPrice: product.currentPrice,
    stock: product.stock,
    basePrice: product.basePrice,
    updatedAt: product.updatedAt || new Date(),
  });
};

const emitFeaturedUpdate = () => {
  if (io) io.emit("featured:updated");
};

module.exports = { attachRealtime, emitFeaturedUpdate, emitProductUpdate };
