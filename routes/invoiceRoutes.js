const express = require("express");
const router = express.Router();
const {
  createInvoiceController,
  createBatchInvoiceController,
  //   getInvoiceById,
  getAllCustomers,
  getAllInvoices,
  getCustomerInvoices,
  getInvoiceByReference,
  fetchInventoryController,
} = require("../invoiceController");

router.post("/invoice/create", createInvoiceController); //

router.post("/invoices/list", getAllInvoices); //

router.post("/customer_invoices/list/:cuscode", getCustomerInvoices); //

router.post("/invoice/batch", createBatchInvoiceController); //

router.post("/invoice/ref/get/:cuscode", getInvoiceByReference); //

router.post("/customers/list/:cuscode", getAllCustomers); //

router.post("/customers/list", getAllCustomers); //

router.post("/inventory/list", fetchInventoryController); //

module.exports = router;
