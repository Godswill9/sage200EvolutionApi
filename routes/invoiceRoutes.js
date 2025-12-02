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
} = require("../invoiceController");

router.post("/invoice/create", createInvoiceController);

router.post("/invoices/list", getAllInvoices);

router.post("/customer_invoices/list", getCustomerInvoices);

router.post("/invoice/batch", createBatchInvoiceController);

router.post("/invoice/ref/get", getInvoiceByReference);

router.post("/customers/list/:cuscode", getAllCustomers);

module.exports = router;
