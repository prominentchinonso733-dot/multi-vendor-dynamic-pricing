const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const EscrowContract = require("../models/EscrowContract");
const { normalizeRole, isSellerRole } = require("./roles");

let io;

const attachRealtime = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });
  io.on("connection", (socket) => {
    socket.on("escrow:join", async ({ contractId, token } = {}, acknowledge) => {
      const respond = typeof acknowledge === "function" ? acknowledge : () => {};
      if (!mongoose.isValidObjectId(contractId) || !token) {
        respond({ success: false, message: "Invalid escrow chat access." });
        return;
      }

      try {
        if (!process.env.JWT_SECRET) {
          respond({ success: false, message: "Chat authentication is unavailable." });
          return;
        }
        const claims = jwt.verify(token, process.env.JWT_SECRET);
        const accountId = claims._id || claims.id;
        const account = await User.findById(accountId)
          .select("role accountStatus")
          .lean();
        const role = normalizeRole(account?.role);
        if (
          !account ||
          account.accountStatus === "SUSPENDED" ||
          role !== normalizeRole(claims.role) ||
          !["BUYER", "SELLER"].includes(role)
        ) {
          respond({ success: false, message: "Chat access is not authorized." });
          return;
        }
        const contract = await EscrowContract.findOne({
          _id: contractId,
          $or: [
            ...(role === "BUYER" ? [{ buyerId: accountId }] : []),
            ...(isSellerRole(role) ? [{ sellerIds: accountId }] : []),
          ],
        })
          .select("_id")
          .lean();
        if (!contract) {
          respond({ success: false, message: "Chat access is not authorized." });
          return;
        }
        socket.join(`escrow:${contractId}`);
        respond({ success: true });
      } catch {
        respond({ success: false, message: "Chat access is not authorized." });
      }
    });
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

const emitEscrowMessage = (message) => {
  if (!io || !message?.contractId) return;
  io.to(`escrow:${message.contractId}`).emit("escrow:message", message);
};

module.exports = {
  attachRealtime,
  emitEscrowMessage,
  emitFeaturedUpdate,
  emitProductUpdate,
};
