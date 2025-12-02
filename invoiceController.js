const axios = require("axios");
const db = require("./config/database"); // mysql2 pool
const xml2js = require("xml2js");
const parser = new xml2js.Parser({ explicitArray: false });

async function createInvoiceController(req, res) {
  try {
    const { invoice, server, port, username, password } = req.body;
    const companyId = process.env.COMPANY_ID;
    const company = process.env.COMPANY_NAME;
    if (!invoice || !server || !port || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }
    const { CustomerCode, Reference } = invoice;

    // =============================================================
    // A. Check if customer exists in Sage 200
    // =============================================================

    const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerCode}`;

    const customerResponse = await axios.get(customerUrl, {
      auth: { username, password },
    });

    if (!customerResponse.data || customerResponse.data.HasError) {
      //   await saveInvoiceLog({
      //     reference: Reference,
      //     companyId: companyId,
      //     customerCode: CustomerCode,
      //     amount: invoice.Amount,
      //     status: "failed",
      //     payload: invoice,
      //     sageResponse: customerResponse.data,
      //   });

      return res.status(404).json({
        success: false,
        message: "Customer not found in Sage",
        data: customerResponse.data,
      });
    }

    // =============================================================
    // B. Prevent duplicates
    // =============================================================

    const [existing] = await db.query(
      "SELECT id FROM invoice_logs WHERE reference = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
      [Reference, CustomerCode]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Duplicate invoice detected",
      });
    }

    // =============================================================
    // C. POST INVOICE TO SAGE 200
    // =============================================================

    const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionPost`;
    const payload = { CustomerTransactionPost: invoice };

    let sageResponse;

    try {
      const response = await axios.post(postUrl, payload, {
        auth: { username, password },
      });

      sageResponse = response.data;

      // When Sage returns an XML <Fault> instead of JSON
      if (typeof sageResponse === "string" && sageResponse.includes("<Fault")) {
        await saveInvoiceLog({
          reference: Reference,
          companyId: companyId,
          customerCode: CustomerCode,
          amount: invoice.Amount,
          status: "failed",
          payload: invoice,
          sageResponse,
        });

        return res.status(400).json({
          success: false,
          message: "Sage returned a Fault response",
          data: sageResponse,
        });
      }

      // When JSON error comes
      if (sageResponse.HasError) {
        await saveInvoiceLog({
          reference: Reference,
          companyId: companyId,
          customerCode: CustomerCode,
          amount: invoice.Amount,
          status: "failed",
          payload: invoice,
          sageResponse,
        });

        return res.status(400).json({
          success: false,
          message: "Sage returned validation errors",
          data: sageResponse,
        });
      }
    } catch (err) {
      await saveInvoiceLog({
        reference: Reference,
        companyId: companyId,
        customerCode: CustomerCode,
        amount: invoice.Amount,
        status: "failed",
        payload: invoice,
        sageResponse: { error: err.message },
      });

      return res.status(500).json({
        success: false,
        message: "Error posting to Sage",
        error: err.message,
      });
    }

    // =============================================================
    // D. SUCCESS
    // =============================================================

    await saveInvoiceLog({
      reference: Reference,
      companyId: companyId,
      customerCode: CustomerCode,
      amount: invoice.Amount,
      status: "posted",
      sageAuditNumber: sageResponse.ID || null,
      payload: invoice,
      sageResponse,
    });

    return res.status(200).json({
      success: true,
      message: "Invoice posted successfully",
      data: sageResponse,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
}

async function createBatchInvoiceController(req, res) {
  try {
    const { invoices, server, port, username, password } = req.body;
    const company = process.env.COMPANY_NAME;
    const companyId = process.env.COMPANY_ID;
    if (!invoices || !Array.isArray(invoices) || invoices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invoices array is required",
      });
    }

    if (!server || !port || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing Sage connection fields",
      });
    }

    const results = [];

    // =============================================================
    // PROCESS EACH INVOICE
    // =============================================================
    for (const invoice of invoices) {
      const { CustomerCode, Reference } = invoice;

      // -------------------------------------------------------------
      // (A) Check if customer exists
      // -------------------------------------------------------------
      const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerCode}`;

      let customerResponse;
      try {
        customerResponse = await axios.get(customerUrl, {
          auth: { username, password },
        });
      } catch (err) {
        await saveInvoiceLog({
          reference: Reference,
          companyId,
          customerCode: CustomerCode,
          amount: invoice.Amount,
          status: "failed",
          payload: invoice,
          sageResponse: { error: "Customer lookup failed" },
        });

        results.push({
          reference: Reference,
          status: "failed",
          error: "Customer lookup failed",
        });
        continue;
      }

      if (!customerResponse.data || customerResponse.data.HasError) {
        await saveInvoiceLog({
          reference: Reference,
          companyId,
          customerCode: CustomerCode,
          amount: invoice.Amount,
          status: "failed",
          payload: invoice,
          sageResponse: customerResponse.data,
        });

        results.push({
          reference: Reference,
          status: "failed",
          error: "Customer not found",
        });
        continue;
      }

      // -------------------------------------------------------------
      // (B) Check duplicates
      // -------------------------------------------------------------
      const [existing] = await db.query(
        "SELECT id FROM invoice_logs WHERE reference = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
        [Reference, CustomerCode]
      );

      if (existing.length > 0) {
        results.push({
          reference: Reference,
          status: "duplicate",
          message: "Invoice already posted",
        });
        continue;
      }

      // -------------------------------------------------------------
      // (C) Post invoice
      // -------------------------------------------------------------
      const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionPost`;
      const payload = { CustomerTransactionPost: invoice };

      let sageResponse;
      try {
        const response = await axios.post(postUrl, payload, {
          auth: { username, password },
        });

        sageResponse = response.data;

        // Handle XML fault
        if (
          typeof sageResponse === "string" &&
          sageResponse.includes("<Fault")
        ) {
          await saveInvoiceLog({
            reference: Reference,
            companyId,
            customerCode: CustomerCode,
            amount: invoice.Amount,
            status: "failed",
            payload: invoice,
            sageResponse,
          });

          results.push({
            reference: Reference,
            status: "failed",
            error: "Sage Fault response",
          });
          continue;
        }

        // JSON error
        if (sageResponse.HasError) {
          await saveInvoiceLog({
            reference: Reference,
            companyId,
            customerCode: CustomerCode,
            amount: invoice.Amount,
            status: "failed",
            payload: invoice,
            sageResponse,
          });

          results.push({
            reference: Reference,
            status: "failed",
            error: "Validation errors",
          });
          continue;
        }
      } catch (err) {
        await saveInvoiceLog({
          reference: Reference,
          companyId,
          customerCode: CustomerCode,
          amount: invoice.Amount,
          status: "failed",
          payload: invoice,
          sageResponse: { error: err.message },
        });

        results.push({
          reference: Reference,
          status: "failed",
          error: err.message,
        });
        continue;
      }

      // -------------------------------------------------------------
      // (D) SUCCESS
      // -------------------------------------------------------------
      await saveInvoiceLog({
        reference: Reference,
        companyId,
        customerCode: CustomerCode,
        amount: invoice.Amount,
        status: "posted",
        sageAuditNumber: sageResponse.ID || null,
        payload: invoice,
        sageResponse,
      });

      results.push({
        reference: Reference,
        status: "posted",
        audit: sageResponse.ID || null,
      });
    }

    // =============================================================
    // END — RETURN BATCH SUMMARY
    // =============================================================
    return res.status(200).json({
      success: true,
      message: "Batch processing completed",
      total: invoices.length,
      summary: results,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Unexpected server error",
      error: err.message,
    });
  }
}

function stripNamespaces(obj) {
  if (Array.isArray(obj)) return obj.map(stripNamespaces);

  if (obj && typeof obj === "object") {
    const cleaned = {};
    for (const key in obj) {
      const cleanKey = key.replace(/.*:/, ""); // remove namespace
      cleaned[cleanKey] = stripNamespaces(obj[key]);
    }
    return cleaned;
  }
  return obj;
}

// async function getInvoiceById(req, res) {
//   try {
//     const { id, server, port, username, password } = req.body;

//     if (!id || !server || !port || !username || !password) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }

//     const url = `${server}:${port}/freedom.core/DPLUS/SDK/Rest/SalesOrderLoadByID?id=${id}`;

//     const response = await axios.get(url, {
//       auth: { username, password },
//     });

//     const cleanData = stripNamespaces(response.data);

//     return res.json({
//       success: true,
//       data: cleanData,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       success: false,
//       message: "Error fetching invoice",
//       error: err.message,
//     });
//   }
// }

async function getAllCustomers(req, res) {
  try {
    const { server, port, username, password } = req.body;
    const { cuscode } = req.params;
    const company = process.env.COMPANY_NAME;
    if (!server || !port || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // =====================================================
    // MODE 2 → FETCH CUSTOMER BY CUSTOMER CODE
    // =====================================================
    if (cuscode) {
      const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?code=${cuscode}`;
      const response = await axios.get(url, {
        auth: { username, password },
      });

      const json = response.data;
      return res.json({
        success: true,
        data: json?.CustomerDto || json,
      });
    }
    // =====================================================
    // MODE 1 → FETCH ALL CUSTOMERS
    // =====================================================
    const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerList?orderby=Account&pageNumber=1&pageSize=5000`;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/xml, text/xml",
      },
    });
    // READ THE BODY
    const xml = await response.text();
    const json = await parser.parseStringPromise(xml);
    let customers = [];

    if (json.ArrayOfCustomerDto?.CustomerDto) {
      customers = Array.isArray(json.ArrayOfCustomerDto.CustomerDto)
        ? json.ArrayOfCustomerDto.CustomerDto
        : [json.ArrayOfCustomerDto.CustomerDto];
    }

    return res.json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Error fetching customers",
      error: err.message,
    });
  }
}

// Reusable XML → JSON converter
async function xmlToJson(xmlString) {
  return await parser.parseStringPromise(xmlString);
}

// -------------------------------
// Helper: fetch customer invoices internally
// -------------------------------
async function getCustomerInvoicesHelper(
  server,
  port,
  authHeader,
  accountCode
) {
  let page = 1;
  const pageSize = 100;
  let allInvoices = [];
  const company = process.env.COMPANY_NAME;
  while (true) {
    const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionListByAccountCode?code=${accountCode}&orderBy=TxDate&pageNumber=${page}&pageSize=${pageSize}`;

    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/xml, text/xml",
      },
    });

    if (!res.ok) break;

    const xml = await res.text();
    const data = await xmlToJson(xml);

    const txList = data?.ArrayOfCustomerTransactionDto?.CustomerTransactionDto;
    if (!txList) break;

    if (Array.isArray(txList)) {
      allInvoices.push(...txList);
    } else {
      allInvoices.push(txList);
    }

    page++;
  }

  return allInvoices;
}

// -------------------------------
// API: Get invoices by customer account code
// -------------------------------
async function getCustomerInvoices(req, res) {
  try {
    const { server, port, username, password, accountCode } = req.body;

    if (!server || !port || !username || !password || !accountCode) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString(
      "base64"
    )}`;

    const invoices = await getCustomerInvoicesHelper(
      server,
      port,
      authHeader,
      accountCode
    );

    return res.json({
      success: true,
      accountCode,
      count: invoices.length,
      invoices,
    });
  } catch (err) {
    console.error("Customer Invoices Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching customer invoices",
      error: err.message,
    });
  }
}

// -------------------------------
// Helper: fetch all customers paginated
// -------------------------------
async function fetchAllCustomers(server, port, authHeader) {
  let customers = [];
  let page = 1;
  const pageSize = 3000;
  const company = process.env.COMPANY_NAME;
  while (true) {
    const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerList?pageNumber=${page}&pageSize=${pageSize}`;

    const res = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/xml, text/xml",
      },
    });

    if (!res.ok) break;

    const xml = await res.text();
    const data = await xmlToJson(xml);

    const list = data?.ArrayOfCustomerDto?.CustomerDto;
    if (!list) break;

    if (Array.isArray(list)) {
      customers = customers.concat(list);
    } else {
      customers.push(list);
    }

    page++;
  }

  return customers;
}

// -------------------------------
// API: Get all invoices for all customers
// -------------------------------
async function getAllInvoices(req, res) {
  try {
    const { server, port, username, password } = req.body;

    if (!server || !port || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString(
      "base64"
    )}`;

    // 1️⃣ Fetch all customers
    const customers = await fetchAllCustomers(server, port, authHeader);

    let allInvoices = [];

    // 2️⃣ Fetch invoices per customer
    for (const c of customers) {
      const acc = c.Account || c.Code; // adjust field based on your XML
      const invoices = await getCustomerInvoicesHelper(
        server,
        port,
        authHeader,
        acc
      );

      allInvoices.push(
        ...invoices.map((inv) => ({
          account: acc,
          reference: inv.Reference,
          description: inv.Description,
          debit: inv.Debit,
          credit: inv.Credit,
          date: inv.Date,
          type: inv.Id,
          raw: inv,
        }))
      );
    }

    return res.json({
      success: true,
      count: allInvoices.length,
      invoices: allInvoices,
    });
  } catch (err) {
    console.error("All Invoices Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching all invoices",
      error: err.message,
    });
  }
}

// =================================================================
// Helper: Save Logs
// =================================================================

async function saveInvoiceLog({
  reference,
  companyId,
  customerCode,
  amount,
  status,
  sageAuditNumber = null,
  payload,
  sageResponse,
  batchId = null,
}) {
  try {
    await db.query(
      `INSERT INTO invoice_logs 
      (reference,companyId, customerCode, amount, status, sageAuditNumber, payload, sageResponse, batchId)
      VALUES (?,?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        companyId,
        customerCode,
        amount,
        status,
        sageAuditNumber,
        JSON.stringify(payload),
        JSON.stringify(sageResponse),
        batchId,
      ]
    );
  } catch (err) {
    console.error("Log Error:", err);
  }
}

async function xmlToJson(xmlString) {
  return await parser.parseStringPromise(xmlString);
}

// -------------------------------
// API: Get single invoice by account & reference
// -------------------------------
async function getInvoiceByReference(req, res) {
  try {
    const { server, port, username, password, account, reference } = req.body;
    const company = process.env.COMPANY_NAME;
    if (!server || !port || !username || !password || !account || !reference) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: server, port, username, password, account, reference",
      });
    }

    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString(
      "base64"
    )}`;
    let page = 1;
    const pageSize = 100;
    let foundInvoice = null;

    // Fetch invoices page by page until we find the matching reference
    while (!foundInvoice) {
      const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionListByAccountCode?code=${account}&orderBy=TxDate&pageNumber=${page}&pageSize=${pageSize}`;

      const response = await fetch(url, {
        headers: {
          Authorization: authHeader,
          Accept: "application/xml, text/xml",
        },
      });

      if (!response.ok) break;

      const xml = await response.text();
      const data = await xmlToJson(xml);

      const txList =
        data?.ArrayOfCustomerTransactionDto?.CustomerTransactionDto;

      if (!txList) break;

      const invoicesArray = Array.isArray(txList) ? txList : [txList];

      foundInvoice = invoicesArray.find((inv) => inv.Reference === reference);

      if (!foundInvoice) page++;
    }

    if (!foundInvoice) {
      return res.status(404).json({
        success: false,
        message: `Invoice ${reference} not found for account ${account}`,
      });
    }

    return res.json({
      success: true,
      account,
      reference,
      invoice: foundInvoice,
    });
  } catch (err) {
    console.error("GetInvoiceByReference Error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching invoice",
      error: err.message,
    });
  }
}

module.exports = {
  createInvoiceController,
  getAllCustomers,
  //   getInvoiceById,
  createBatchInvoiceController,
  getCustomerInvoices,
  getAllInvoices,
  getInvoiceByReference,
};
