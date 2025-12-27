const axios = require("axios");
const { db } = require("./config/database"); // mysql2 pool
const xml2js = require("xml2js");
const parser = new xml2js.Parser({ explicitArray: false });
const { createInvoiceLines, getFullInvoice } = require("./sage200dbController"); // if needed

// async function createInvoiceController(req, res) {
//   try {
//     const { invoice, server, port, username, password, company } = req.body;
//     const companyId = process.env.COMPANY_ID;
// const company = process.env.COMPANY_NAME;
//     if (!invoice || !server || !port || !username || !password) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }
//     const { CustomerCode, Reference } = invoice;

//     // =============================================================
//     // A. Check if customer exists in Sage 200
//     // =============================================================

//     const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerCode}`;

//     const customerResponse = await axios.get(customerUrl, {
//       auth: { username, password },
//     });

//     if (!customerResponse.data || customerResponse.data.HasError) {
//       return res.status(404).json({
//         success: false,
//         message: "Customer not found in Sage",
//         data: customerResponse.data,
//       });
//     }

//     // =============================================================
//     // B. Prevent duplicates
//     // =============================================================

//     const [existing] = await db.query(
//       "SELECT id FROM invoice_logs WHERE reference = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
//       [Reference, CustomerCode]
//     );

//     if (existing.length > 0) {
//       return res.status(409).json({
//         success: false,
//         message: "Duplicate invoice detected",
//       });
//     }

//     // =============================================================
//     // C. POST INVOICE TO SAGE 200
//     // =============================================================

//     const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionPost`;
//     const payload = { CustomerTransactionPost: invoice };

//     let sageResponse;

//     try {
//       const response = await axios.post(postUrl, payload, {
//         auth: { username, password },
//       });

//       sageResponse = response.data;

//       // When Sage returns an XML <Fault> instead of JSON
//       if (typeof sageResponse === "string" && sageResponse.includes("<Fault")) {
//         await saveInvoiceLog({
//           reference: Reference,
//           companyId: companyId,
//           customerCode: CustomerCode,
//           amount: invoice.Amount,
//           status: "failed",
//           payload: invoice,
//           sageResponse,
//         });

//         return res.status(400).json({
//           success: false,
//           message: "Sage returned a Fault response",
//           data: sageResponse,
//         });
//       }

//       // When JSON error comes
//       if (sageResponse.HasError) {
//         await saveInvoiceLog({
//           reference: Reference,
//           companyId: companyId,
//           customerCode: CustomerCode,
//           amount: invoice.Amount,
//           status: "failed",
//           payload: invoice,
//           sageResponse,
//         });

//         return res.status(400).json({
//           success: false,
//           message: "Sage returned validation errors",
//           data: sageResponse,
//         });
//       }
//     } catch (err) {
//       await saveInvoiceLog({
//         reference: Reference,
//         companyId: companyId,
//         customerCode: CustomerCode,
//         amount: invoice.Amount,
//         status: "failed",
//         payload: invoice,
//         sageResponse: { error: err.message },
//       });

//       return res.status(500).json({
//         success: false,
//         message: "Error posting to Sage",
//         error: err.message,
//       });
//     }

//     // =============================================================
//     // D. SUCCESS
//     // =============================================================

//     await saveInvoiceLog({
//       reference: Reference,
//       companyId: companyId,
//       customerCode: CustomerCode,
//       amount: invoice.Amount,
//       status: "posted",
//       sageAuditNumber: sageResponse.ID || null,
//       payload: invoice,
//       sageResponse,
//     });

//     return res.status(200).json({
//       success: true,
//       message: "Invoice posted successfully",
//       data: sageResponse,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       success: false,
//       message: "Unexpected server error",
//       error: err.message,
//     });
//   }
// }

function calculateTotals(lines) {
  const TAX_RATE = 0.14; // 14%

  let totalExcl = 0;
  let totalTax = 0;

  for (const line of lines) {
    const qty = Number(line.Quantity) || 0;
    const unitPrice = Number(line.UnitPrice) || 0;
    const lineTotal = qty * unitPrice;

    totalExcl += lineTotal;

    // Tax codes 1–5 = 14%, 6–7 = 0%
    const taxCode = Number(line.TaxCode);
    const tax = taxCode >= 1 && taxCode <= 5 ? lineTotal * TAX_RATE : 0;

    totalTax += tax;
  }

  return {
    totalTaxExclusive: Number(totalExcl.toFixed(2)),
    totalTax: Number(totalTax.toFixed(2)),
    totalTaxInclusive: Number((totalExcl + totalTax).toFixed(2)),
  };
}

async function createInvoiceController(req, res) {
  try {
    const { invoice, server, port, username, password, company } = req.body; // add lineItems
    const companyId = process.env.COMPANY_ID;
    // const company = process.env.COMPANY_NAME;
    if (!invoice || !server || !port || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const { CustomerAccountCode, OrderNo } = invoice;

    // =============================================================
    // A. Check if customer exists
    // =============================================================
    const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerAccountCode}`;
    const customerResponse = await axios.get(customerUrl, {
      auth: { username, password },
    });

    if (!customerResponse.data || customerResponse.data.HasError) {
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
      "SELECT id FROM invoice_logs WHERE OrderNo = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
      [OrderNo, CustomerAccountCode]
    );

    if (existing.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Duplicate invoice detected" });
    }

    function extractInvoiceReference(response) {
      if (!response?.ID) return null;

      const match = response.ID.match(/Reference:([^|]+)/);
      return match ? match[1].trim() : null;
    }

    // =============================================================
    // C. POST INVOICE TO SAGE 200
    // =============================================================
    const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/SalesOrderProcessInvoice`;
    const payload = { SalesOrder: invoice };
    let reference;
    let sageResponse;
    try {
      const response = await axios.post(postUrl, payload, {
        auth: { username, password },
      });
      sageResponse = response.data;
      reference = extractInvoiceReference(sageResponse);

      if (typeof sageResponse === "string" && sageResponse.includes("<Fault")) {
        await saveInvoiceLog({
          reference: reference,
          companyId,
          customerCode: CustomerAccountCode,
          orderNo: OrderNo,
          amount: calculateTotals(invoice.Lines).totalTaxExclusive,
          amountWithTax: calculateTotals(invoice.Lines).totalTaxInclusive,
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

      if (sageResponse.HasError) {
        await saveInvoiceLog({
          reference: reference,
          companyId,
          customerCode: CustomerAccountCode,
          orderNo: OrderNo,
          amount: calculateTotals(invoice.Lines).totalTaxExclusive,
          amountWithTax: calculateTotals(invoice.Lines).totalTaxInclusive,
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
        reference: reference,
        companyId,
        customerCode: CustomerAccountCode,
        orderNo: OrderNo,
        amount: calculateTotals(invoice.Lines).totalTaxExclusive,
        amountWithTax: calculateTotals(invoice.Lines).totalTaxInclusive,
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
    // D. SUCCESS - Save invoice in logs
    // =============================================================
    const savedInvoice = await saveInvoiceLog({
      reference: reference,
      companyId,
      customerCode: CustomerAccountCode,
      orderNo: OrderNo,
      amount: calculateTotals(invoice.Lines).totalTaxExclusive,
      amountWithTax: calculateTotals(invoice.Lines).totalTaxInclusive,
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

// async function createInvoiceController(req, res) {
//   try {
//     const {
//       invoice,
//       server,
//       port,
//       username,
//       password,
//       sageDbUser,
//       sageDbPass,
//       sageDbHost,
//       sageDbName,
//     } = req.body; // add lineItems
//     const companyId = process.env.COMPANY_ID;
// const company = process.env.COMPANY_NAME;
//     const lineItems = invoice.LineItems;
//     if (!invoice || !server || !port || !username || !password) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }

//     const { CustomerCode, Reference } = invoice;

//     // =============================================================
//     // A. Check if customer exists
//     // =============================================================
//     const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerCode}`;
//     const customerResponse = await axios.get(customerUrl, {
//       auth: { username, password },
//     });

//     if (!customerResponse.data || customerResponse.data.HasError) {
//       return res.status(404).json({
//         success: false,
//         message: "Customer not found in Sage",
//         data: customerResponse.data,
//       });
//     }

//     // =============================================================
//     // B. Prevent duplicates
//     // =============================================================
//     const [existing] = await db.query(
//       "SELECT id FROM invoice_logs WHERE reference = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
//       [Reference, CustomerCode]
//     );

//     if (existing.length > 0) {
//       return res
//         .status(409)
//         .json({ success: false, message: "Duplicate invoice detected" });
//     }

//     // =============================================================
//     // C. POST INVOICE TO SAGE 200
//     // =============================================================
//     const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionPost`;
//     const payload = { CustomerTransactionPost: invoice };

//     let sageResponse;
//     try {
//       const response = await axios.post(postUrl, payload, {
//         auth: { username, password },
//       });
//       sageResponse = response.data;
//       if (typeof sageResponse === "string" && sageResponse.includes("<Fault")) {
//         await saveInvoiceLog({
//           reference: Reference,
//           companyId,
//           customerCode: CustomerCode,
//           amount: invoice.Amount,
//           status: "failed",
//           payload: invoice,
//           sageResponse,
//         });
//         return res.status(400).json({
//           success: false,
//           message: "Sage returned a Fault response",
//           data: sageResponse,
//         });
//       }

//       if (sageResponse.HasError) {
//         await saveInvoiceLog({
//           reference: Reference,
//           companyId,
//           customerCode: CustomerCode,
//           amount: invoice.Amount,
//           status: "failed",
//           payload: invoice,
//           sageResponse,
//         });
//         return res.status(400).json({
//           success: false,
//           message: "Sage returned validation errors",
//           data: sageResponse,
//         });
//       }
//     } catch (err) {
//       await saveInvoiceLog({
//         reference: Reference,
//         companyId,
//         customerCode: CustomerCode,
//         amount: invoice.Amount,
//         status: "failed",
//         payload: invoice,
//         sageResponse: { error: err.message },
//       });
//       return res.status(500).json({
//         success: false,
//         message: "Error posting to Sage",
//         error: err.message,
//       });
//     }

//     // =============================================================
//     // D. SUCCESS - Save invoice in logs
//     // =============================================================
//     const savedInvoice = await saveInvoiceLog({
//       reference: Reference,
//       companyId,
//       customerCode: CustomerCode,
//       amount: invoice.Amount,
//       status: "posted",
//       sageAuditNumber: sageResponse.ID || null,
//       payload: invoice,
//       sageResponse,
//     });

//     // =============================================================
//     // E. CREATE LINE ITEMS IN DATABASE
//     // =============================================================
//     const match = sageResponse.ID.match(/ID:(\d+)/);
//     const lineId = 1;
//     if (lineItems && Array.isArray(lineItems) && lineItems.length > 0) {
//       if (match) {
//         // const id = parseInt(match[1], 10);
//         const id = 11;
//         await createInvoiceLines(
//           id,
//           lineItems,
//           sageDbUser,
//           sageDbPass,
//           sageDbHost,
//           sageDbName,
//           lineId
//         ); // id from invoice log
//         console.log(id); // 38
//       } else {
//         console.log("ID not found");
//       }
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Invoice posted successfully",
//       data: sageResponse,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       success: false,
//       message: "Unexpected server error",
//       error: err.message,
//     });
//   }
// }

async function createBatchInvoiceController(req, res) {
  try {
    const { invoices, server, port, username, password, company } = req.body;
    // const company = process.env.COMPANY_NAME;
    const companyId = process.env.COMPANY_ID;

    if (!Array.isArray(invoices) || invoices.length === 0) {
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

    function extractInvoiceReference(response) {
      if (!response?.ID) return null;
      const match = response.ID.match(/Reference:([^|]+)/);
      return match ? match[1].trim() : null;
    }

    // =============================================================
    // PROCESS EACH INVOICE
    // =============================================================
    for (const invoice of invoices) {
      const { CustomerAccountCode, OrderNo, Lines } = invoice;

      let reference = null;

      try {
        // ---------------------------------------------------------
        // A. Check if customer exists
        // ---------------------------------------------------------
        const customerUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerFind?module=AR&code=${CustomerAccountCode}`;
        const customerResponse = await axios.get(customerUrl, {
          auth: { username, password },
        });

        if (!customerResponse.data || customerResponse.data.HasError) {
          throw new Error("Customer not found in Sage");
        }

        // ---------------------------------------------------------
        // B. Prevent duplicates
        // ---------------------------------------------------------
        const [existing] = await db.query(
          "SELECT id FROM invoice_logs WHERE OrderNo = ? AND customerCode = ? AND status = 'posted' LIMIT 1",
          [OrderNo, CustomerAccountCode]
        );

        if (existing.length > 0) {
          results.push({
            orderNo: OrderNo,
            status: "duplicate",
          });
          continue;
        }

        // ---------------------------------------------------------
        // C. Post invoice to Sage
        // ---------------------------------------------------------
        const postUrl = `${server}:${port}/freedom.core/${company}/SDK/Rest/SalesOrderProcessInvoice`;
        const payload = { SalesOrder: invoice };

        const response = await axios.post(postUrl, payload, {
          auth: { username, password },
        });

        const sageResponse = response.data;
        reference = extractInvoiceReference(sageResponse);

        if (
          typeof sageResponse === "string" &&
          sageResponse.includes("<Fault")
        ) {
          throw new Error("Sage Fault response");
        }

        if (sageResponse.HasError) {
          throw new Error("Sage validation error");
        }

        // ---------------------------------------------------------
        // D. Save success log
        // ---------------------------------------------------------
        await saveInvoiceLog({
          reference,
          companyId,
          customerCode: CustomerAccountCode,
          orderNo: OrderNo,
          amount: calculateTotals(Lines).totalTaxExclusive,
          amountWithTax: calculateTotals(Lines).totalTaxInclusive,
          status: "posted",
          sageAuditNumber: sageResponse.ID || null,
          payload: invoice,
          sageResponse,
        });

        results.push({
          orderNo: OrderNo,
          reference,
          status: "posted",
          audit: sageResponse.ID || null,
        });
      } catch (err) {
        await saveInvoiceLog({
          reference,
          companyId,
          customerCode: CustomerAccountCode,
          orderNo: OrderNo,
          amount: calculateTotals(invoice.Lines || []).totalTaxExclusive,
          amountWithTax: calculateTotals(invoice.Lines || []).totalTaxInclusive,
          status: "failed",
          payload: invoice,
          sageResponse: { error: err.message },
        });

        results.push({
          orderNo: OrderNo,
          status: "failed",
          error: err.message,
        });
      }
    }

    // =============================================================
    // RETURN BATCH SUMMARY
    // =============================================================
    return res.status(200).json({
      success: true,
      message: "Batch invoice processing completed",
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
//     const { id, server, port, username, password, company } = req.body;

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
    const { server, port, username, password, company } = req.body;
    const { cuscode } = req.params;
    // const company = process.env.COMPANY_NAME;
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
// async function getCustomerInvoicesHelper(
//   server,
//   port,
//   authHeader,
//   accountCode
// ) {
//   let page = 1;
//   const pageSize = 1000000;
//   let allInvoices = [];
// const company = process.env.COMPANY_NAME;
//   while (true) {
//     const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/CustomerTransactionListByAccountCode?code=${accountCode}&orderBy=TxDate&pageNumber=${page}&pageSize=${pageSize}`;

//     const res = await fetch(url, {
//       headers: {
//         Authorization: authHeader,
//         Accept: "application/xml, text/xml",
//       },
//     });

//     if (!res.ok) break;

//     const xml = await res.text();
//     const data = await xmlToJson(xml);

//     const txList = data?.ArrayOfCustomerTransactionDto?.CustomerTransactionDto;
//     if (!txList) break;

//     if (Array.isArray(txList)) {
//       allInvoices.push(...txList);
//     } else {
//       allInvoices.push(txList);
//     }

//     page++;
//   }

//   return allInvoices;
// }

async function getCustomerInvoicesHelper(
  server,
  port,
  authHeader,
  accountCode,
  company
) {
  let page = 1;
  const pageSize = 1000000;
  let allInvoices = [];
  // const company = process.env.COMPANY_NAME;

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

    // Ensure we always work with an array
    const invoices = Array.isArray(txList) ? txList : [txList];

    // for (const invoice of invoices) {
    //   try {
    //     // get invoiceId from Sage / your DB
    //     const invoiceId = parseInt(invoice?.ID || invoice?.AutoIndex, 10);
    //     if (invoiceId) {
    //       // fetch full invoice (lines + details)
    //       const fullInvoice = await getFullInvoice(
    //         invoiceId,
    //         sageDbUser,
    //         sageDbPass,
    //         sageDbHost,
    //         sageDbName
    //       );
    //       invoice.lines = fullInvoice.lines || [];
    //     } else {
    //       invoice.lines = [];
    //     }
    //   } catch (err) {
    //     console.error(
    //       `Error fetching lines for invoice ${invoice?.ID}:`,
    //       err.message
    //     );
    //     invoice.lines = [];
    //   }
    // }

    allInvoices.push(...invoices);
    page++;
  }

  return allInvoices;
}

// -------------------------------
// API: Get invoices by customer account code
// -------------------------------
async function getCustomerInvoices(req, res) {
  try {
    const { server, port, username, password, company } = req.body;
    const accountCode = req.params.cuscode;
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
      accountCode,
      company
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
async function fetchAllCustomers(server, port, authHeader, company) {
  let customers = [];
  let page = 1;
  const pageSize = 3000;
  // const company = process.env.COMPANY_NAME;
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
    const { server, port, username, password, company } = req.body;

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
    const customers = await fetchAllCustomers(
      server,
      port,
      authHeader,
      company
    );

    let allInvoices = [];

    // 2️⃣ Fetch invoices per customer
    for (const c of customers) {
      const acc = c.Account || c.Code; // adjust field based on your XML
      const invoices = await getCustomerInvoicesHelper(
        server,
        port,
        authHeader,
        acc,
        company
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
  orderNo,
  amount,
  amountWithTax,
  status,
  sageAuditNumber = null,
  payload,
  sageResponse,
  batchId = null,
}) {
  try {
    const now = new Date();

    await db.query(
      `INSERT INTO invoice_logs 
      (
        companyId,
        reference,
        customerCode,
        OrderNo,
        amount,
        amountWithTax,
        status,
        sageAuditNumber,
        payload,
        sageResponse,
        batchId,
        createdAt,
        postedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        reference,
        customerCode,
        orderNo,
        amount,
        amountWithTax,
        status,
        sageAuditNumber,
        JSON.stringify(payload),
        JSON.stringify(sageResponse),
        batchId,
        now,
        status === "posted" ? now : null,
      ]
    );
  } catch (err) {
    console.error("Invoice Log Error:", err);
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
    const { server, port, username, password, reference, company } = req.body;
    const account = req.params.cuscode;
    // const company = process.env.COMPANY_NAME;
    if (!server || !port || !username || !password || !account || !reference) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: server, port, username, password, company, account, reference",
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
      console.log(url);
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
    const invoiceId = parseInt(foundInvoice?.ID || foundInvoice?.AutoIndex, 10);
    // if (invoiceId) {
    //   // fetch full foundInvoice (lines + details)
    //   const fullInvoice = await getFullInvoice(
    //     invoiceId,
    //     sageDbUser,
    //     sageDbPass,
    //     sageDbHost,
    //     sageDbName
    //   );
    //   foundInvoice.lines = fullInvoice.lines || [];
    // } else {
    //   foundInvoice.lines = [];
    // }

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

async function fetchInventoryController(req, res) {
  try {
    const {
      server,
      port,
      username,
      password,
      pageNumber = 1,
      pageSize = 100,
      company,
    } = req.body;

    const companyId = process.env.COMPANY_ID;
    // const company = process.env.COMPANY_NAME;
    if (!server || !port || !company || !username || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: server, port, company, username, password",
      });
    }

    const url = `${server}:${port}/freedom.core/${company}/SDK/Rest/InventoryItemList?pageNumber=${pageNumber}&pageSize=${pageSize}`;

    const response = await axios.get(url, {
      auth: { username, password },
      headers: { Accept: "application/xml" },
    });

    // Convert XML to JSON
    const parser = new xml2js.Parser({ explicitArray: false });
    const json = await parser.parseStringPromise(response.data);
    const itemsRaw = json.ArrayOfInventoryItemDto?.InventoryItemDto || [];
    const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];

    const inventory = itemsArray.map((item) => ({
      id: Number(item.ID),
      code: item.Code,
      description: item.Description,
      HighestUnitCost: Number(item.HighestUnitCost || 0),
      InitialLotStatusID: Number(item.InitialLotStatusID || 0),
      IsAttribute: item.IsAttribute === "true",
      IsCommissionable: item.IsCommissionable === "true",
      IsLotTracked: item.IsLotTracked === "true",
      IsSerialTracked: item.IsSerialTracked === "true",
      IsServiceItem: item.IsServiceItem === "true",
      IsStrictSerialTracked: item.IsStrictSerialTracked === "true",
      IsUnitsOfMeasure: item.IsUnitsOfMeasure === "true",
      IsWarehouseTracked: item.IsWarehouseTracked === "true",
      LastGrvCost: Number(item.LastGrvCost || 0),
      LatestUnitCost: Number(item.LatestUnitCost || 0),
      LotsExpire: item.LotsExpire === "true",
      LowestUnitCost: Number(item.LowestUnitCost || 0),

      DefaultInvoicingTaxType: {
        Code: item.DefaultInvoicingTaxType?.Code || "1",
        ID: item.DefaultInvoicingTaxType?.ID || "0",
        Description: item.DefaultInvoicingTaxType?.Description || "Output Tax",
        Rate: Number(item.DefaultInvoicingTaxType?.Rate || 0),
      },
      DefaultCreditNoteTaxType: {
        Code: item.DefaultCreditNoteTaxType?.Code || "5",
        ID: item.DefaultCreditNoteTaxType?.ID || "0",
        Description:
          item.DefaultCreditNoteTaxType?.Description || "Input Tax Adjustment",
        Rate: Number(item.DefaultCreditNoteTaxType?.Rate || 0),
      },
      DefaultGoodsReceivedTaxType: {
        Code: item.DefaultGoodsReceivedTaxType?.Code || "3",
        ID: item.DefaultGoodsReceivedTaxType?.ID || "0",
        Description:
          item.DefaultGoodsReceivedTaxType?.Description || "Input Tax",
        Rate: Number(item.DefaultGoodsReceivedTaxType?.Rate || 0),
      },

      QtyFree: Number(item.QtyFree || 0),
      QtyOnHand: Number(item.QtyOnHand || 0),
      QtyOnPurchaseOrder: Number(item.QtyOnPurchaseOrder || 0),
      QtyOnSalesOrder: Number(item.QtyOnSalesOrder || 0),
      QtyReserved: Number(item.QtyReserved || 0),
      QtyWIP: Number(item.QtyWIP || 0),
      StandardUnitCost: Number(item.StandardUnitCost || 0),
    }));

    return res.status(200).json({
      success: true,
      data: inventory,
    });
  } catch (err) {
    console.error("Error fetching inventory items:", err.message);
    return res.status(500).json({
      success: false,
      message: "Error fetching inventory items",
      error: err.message,
    });
  }
}

// async function createInventoryItem(req, res) {
//   try {
//     const { server, port, username, password, company, item } = req.body;

//     if (!server || !port || !username || !password || !item?.Code || !item?.Description) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing required fields",
//       });
//     }

//     const url = `${server}:${port}/freedom.core/DPLUS/SDK/Rest/InventoryItemInsert`;

//     // Default values
//     const payload = {
//       Code: item.Code,
//       Description: item.Description,
//       Description_2: item.Description_2 || "",
//       Description_3: item.Description_3 || "",
//       Active: item.Active ?? true,
//       IsServiceItem: item.IsServiceItem ?? true,
//       IsCommissionable: item.IsCommissionable ?? true,
//       IsLotTracked: item.IsLotTracked ?? false,
//       IsSerialTracked: item.IsSerialTracked ?? false,
//       IsWarehouseTracked: item.IsWarehouseTracked ?? false,
//       IsStrictSerialTracked: item.IsStrictSerialTracked ?? false,
//       LotsExpire: item.LotsExpire ?? false,
//       DefaultInvoicingTaxType: item.DefaultInvoicingTaxType || { Code: "1", ID: "0", Description: "Output Tax", Rate: "14" },
//       DefaultCreditNoteTaxType: item.DefaultCreditNoteTaxType || { Code: "5", ID: "0", Description: "Input Tax Adjustment", Rate: "14" },
//       DefaultGoodsReceivedTaxType: item.DefaultGoodsReceivedTaxType || { Code: "3", ID: "0", Description: "Input Tax", Rate: "14" },
//     };

//     // Sage expects InventoryItem wrapper
//     const requestBody = { InventoryItem: payload };

//     const response = await axios.post(url, requestBody, {
//       auth: { username, password },
//     });

//     if (response.data.HasError) {
//       return res.status(400).json({
//         success: false,
//         message: "Sage returned validation errors",
//         data: response.data,
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Inventory item created successfully",
//       data: response.data,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       success: false,
//       message: "Error creating inventory item",
//       error: err.message,
//     });
//   }
// }

module.exports = {
  createInvoiceController,
  getAllCustomers,
  //   getInvoiceById,
  createBatchInvoiceController,
  getCustomerInvoices,
  getAllInvoices,
  getInvoiceByReference,
  fetchInventoryController,
};
