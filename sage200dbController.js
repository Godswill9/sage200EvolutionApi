const { sql, getSagePool } = require("./config/database");

/**
 * Get invoice lines by iInvoiceID
 */
async function getInvoiceLines(invoiceId, user, password, host, database) {
  const pool = await getSagePool({ user, password, host, database });

  const result = await pool.request().input("invoiceId", sql.Int, invoiceId)
    .query(`
      SELECT *
      FROM _btblInvoiceLines
      WHERE iInvoiceID = @invoiceId
      ORDER BY idInvoiceLines
    `);

  return result.recordset;
}

/**
 * Get invoice line details by invoice line ID
 */
async function getInvoiceLineDetails(
  invoiceLineId,
  user,
  password,
  host,
  database
) {
  const pool = await getSagePool({ user, password, host, database });

  const result = await pool
    .request()
    .input("invoiceLineId", sql.Int, invoiceLineId).query(`
      SELECT *
      FROM _btblInvoiceLineDetails
      WHERE iLDInvoiceLineID = @invoiceLineId
    `);

  return result.recordset;
}

async function createInvoiceLines(
  invoiceId,
  lineItems,
  user,
  password,
  host,
  database,
  lineId
) {
  if (!Number.isInteger(invoiceId)) {
    throw new Error("invoiceId must be an integer (iInvoiceID)");
  }

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    throw new Error("lineItems must be a non-empty array");
  }

  const pool = await getSagePool({ user, password, host, database });

  for (const item of lineItems) {
    const {
      description,
      stockCodeId,
      warehouseId = 0,
      taxTypeId,
      quantity,
      pricing,
      taxAmount,
      uom,
      flags,
      delivery,
    } = item;

    // map all totals and quantities to the DB fields
    const query = `
      INSERT INTO _btblInvoiceLines (
        iInvoiceID,
        cDescription,
        iStockCodeID,
        iWarehouseID,
        iTaxTypeID,
        fQuantity,
        fQtyToProcess,
        fQtyLastProcess,
        fQtyProcessed,
        fUnitPriceExcl,
        fUnitPriceIncl,
        fLineDiscount,
        fQuantityLineTotIncl,
        fQuantityLineTotExcl,
        fQuantityLineTotInclNoDisc,
        fQuantityLineTotExclNoDisc,
        fQuantityLineTaxAmount,
        fQuantityLineTaxAmountNoDisc,
        fQtyChangeLineTotIncl,
        fQtyChangeLineTotExcl,
        fQtyChangeLineTotInclNoDisc,
        fQtyChangeLineTotExclNoDisc,
        fQtyChangeLineTaxAmount,
        fQtyChangeLineTaxAmountNoDisc,
        fQtyToProcessLineTotIncl,
        fQtyToProcessLineTotExcl,
        fQtyToProcessLineTotInclNoDisc,
        fQtyToProcessLineTotExclNoDisc,
        fQtyToProcessLineTaxAmount,
        fQtyToProcessLineTaxAmountNoDisc,
        fQtyLastProcessLineTotIncl,
        fQtyLastProcessLineTotExcl,
        fQtyLastProcessLineTotInclNoDisc,
        fQtyLastProcessLineTotExclNoDisc,
        fQtyLastProcessLineTaxAmount,
        fQtyLastProcessLineTaxAmountNoDisc,
        fQtyProcessedLineTotIncl,
        fQtyProcessedLineTotExcl,
        fQtyProcessedLineTotInclNoDisc,
        fQtyProcessedLineTotExclNoDisc,
        fQtyProcessedLineTaxAmount,
        fQtyProcessedLineTaxAmountNoDisc,
        fUnitPriceExclForeign,
        fUnitPriceInclForeign,
        fUnitCost,
        iUnitsOfMeasureID,
        iUnitsOfMeasureCategoryID,
        iUnitsOfMeasureStockingID,
        bIsWhseItem,
        bIsSerialItem,
        bIsLotItem,
        dDeliveryDate,
        fQtyForDelivery,
        cLineNotes,
        fTaxRate,
        fQtyForDeliveryUR, 
        fQtyProcessedUR, 
        fQtyLastProcessUR, 
        fQuantityUR, 
        iLineID
      ) VALUES (
        @invoiceId, @description, @stockCodeId, @warehouseId, @taxTypeId,
        @fQuantity, @fQtyToProcess, @fQtyLastProcess, @fQtyProcessed,
        @fUnitPriceExcl, @fUnitPriceIncl, @fLineDiscount,
        @fQuantityLineTotIncl, @fQuantityLineTotExcl, @fQuantityLineTotInclNoDisc, @fQuantityLineTotExclNoDisc,
        @fQuantityLineTaxAmount, @fQuantityLineTaxAmountNoDisc,
        @fQtyChangeLineTotIncl, @fQtyChangeLineTotExcl, @fQtyChangeLineTotInclNoDisc, @fQtyChangeLineTotExclNoDisc,
        @fQtyChangeLineTaxAmount, @fQtyChangeLineTaxAmountNoDisc,
        @fQtyToProcessLineTotIncl, @fQtyToProcessLineTotExcl, @fQtyToProcessLineTotInclNoDisc, @fQtyToProcessLineTotExclNoDisc,
        @fQtyToProcessLineTaxAmount, @fQtyToProcessLineTaxAmountNoDisc,
        @fQtyLastProcessLineTotIncl, @fQtyLastProcessLineTotExcl, @fQtyLastProcessLineTotInclNoDisc, @fQtyLastProcessLineTotExclNoDisc,
        @fQtyLastProcessLineTaxAmount, @fQtyLastProcessLineTaxAmountNoDisc,
        @fQtyProcessedLineTotIncl, @fQtyProcessedLineTotExcl, @fQtyProcessedLineTotInclNoDisc, @fQtyProcessedLineTotExclNoDisc,
        @fQtyProcessedLineTaxAmount, @fQtyProcessedLineTaxAmountNoDisc,
        @fUnitPriceExclForeign, @fUnitPriceInclForeign, @fUnitCost,
        @iUnitsOfMeasureID, @iUnitsOfMeasureCategoryID, @iUnitsOfMeasureStockingID,
        @bIsWhseItem, @bIsSerialItem, @bIsLotItem,
        @dDeliveryDate, @fQtyForDelivery, @cLineNotes, @fTaxRate, @fQtyForDeliveryUR, @fQtyProcessedUR, @fQtyLastProcessUR, @fQuantityUR, @iLineID
      )
    `;

    await pool
      .request()
      .input("invoiceId", sql.Int, invoiceId)
      .input("description", sql.NVarChar, description)
      .input("stockCodeId", sql.Int, stockCodeId)
      .input("warehouseId", sql.Int, warehouseId)
      .input("taxTypeId", sql.Int, taxTypeId)
      .input("fQuantity", sql.Float, quantity || 0)
      .input("fQtyToProcess", sql.Float, 0)
      .input("fQtyLastProcess", sql.Float, quantity || 0)
      .input("fQtyProcessed", sql.Float, quantity || 0)
      .input("fUnitPriceExcl", sql.Float, pricing?.unitPriceExcl || 0)
      .input("fUnitPriceIncl", sql.Float, pricing?.unitPriceIncl || 0)
      .input("fLineDiscount", sql.Float, pricing?.discountPercent || 0)
      .input(
        "fQuantityLineTotIncl",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQuantityLineTotExcl",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input(
        "fQuantityLineTotInclNoDisc",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQuantityLineTotExclNoDisc",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input("fQuantityLineTaxAmount", sql.Float, taxAmount || 0)
      .input("fQuantityLineTaxAmountNoDisc", sql.Float, taxAmount || 0)
      .input("fQtyChangeLineTotIncl", sql.Float, 0)
      .input("fQtyChangeLineTotExcl", sql.Float, 0)
      .input("fQtyChangeLineTotInclNoDisc", sql.Float, 0)
      .input("fQtyChangeLineTotExclNoDisc", sql.Float, 0)
      .input("fQtyChangeLineTaxAmount", sql.Float, 0)
      .input("fQtyChangeLineTaxAmountNoDisc", sql.Float, 0)
      .input("fQtyToProcessLineTotIncl", sql.Float, 0)
      .input("fQtyToProcessLineTotExcl", sql.Float, 0)
      .input("fQtyToProcessLineTotInclNoDisc", sql.Float, 0)
      .input("fQtyToProcessLineTotExclNoDisc", sql.Float, 0)
      .input("fQtyToProcessLineTaxAmount", sql.Float, 0)
      .input("fQtyToProcessLineTaxAmountNoDisc", sql.Float, 0)
      .input(
        "fQtyLastProcessLineTotIncl",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQtyLastProcessLineTotExcl",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input(
        "fQtyLastProcessLineTotInclNoDisc",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQtyLastProcessLineTotExclNoDisc",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input("fQtyLastProcessLineTaxAmount", sql.Float, taxAmount || 0)
      .input("fQtyLastProcessLineTaxAmountNoDisc", sql.Float, taxAmount || 0)
      .input(
        "fQtyProcessedLineTotIncl",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQtyProcessedLineTotExcl",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input(
        "fQtyProcessedLineTotInclNoDisc",
        sql.Float,
        pricing?.unitPriceIncl * quantity || 0
      )
      .input(
        "fQtyProcessedLineTotExclNoDisc",
        sql.Float,
        pricing?.unitPriceExcl * quantity || 0
      )
      .input("fQtyProcessedLineTaxAmount", sql.Float, taxAmount || 0)
      .input("fQtyProcessedLineTaxAmountNoDisc", sql.Float, taxAmount || 0)
      .input("fUnitPriceExclForeign", sql.Float, 0)
      .input("fUnitPriceInclForeign", sql.Float, 0)
      .input("fUnitCost", sql.Float, 0)
      .input("iUnitsOfMeasureID", sql.Int, uom?.uomId || 0)
      .input("iUnitsOfMeasureCategoryID", sql.Int, uom?.uomCategoryId || 0)
      .input("iUnitsOfMeasureStockingID", sql.Int, uom?.stockingUomId || 0)
      .input("bIsWhseItem", sql.Bit, flags?.isWarehouseItem || false)
      .input("bIsSerialItem", sql.Bit, flags?.isSerialItem || false)
      .input("bIsLotItem", sql.Bit, flags?.isLotItem || false)
      .input("dDeliveryDate", sql.DateTime, delivery?.deliveryDate || null)
      .input("fQtyForDelivery", sql.Float, quantity || 0)
      .input("cLineNotes", sql.NVarChar, "")
      .input("fTaxRate", sql.Float, pricing.taxRate || 0)
      .input("fQtyForDeliveryUR", sql.Float, quantity || 0)
      .input("fQtyProcessedUR", sql.Float, quantity || 0)
      .input("fQtyLastProcessUR", sql.Float, quantity || 0)
      .input("fQuantityUR", sql.Float, quantity || 0)
      .input("iLineID", sql.Float, lineId || 0)
      .query(query);
  }

  return true;
}

/**
 * Get full invoice (lines + details)
 */
async function getFullInvoice(invoiceId, user, password, host, database) {
  if (!Number.isInteger(invoiceId)) {
    throw new Error("invoiceId must be an integer (iInvoiceID)");
  }

  const lines = await getInvoiceLines(
    invoiceId,
    user,
    password,
    host,
    database
  );

  for (const line of lines) {
    line.details = await getInvoiceLineDetails(
      line.idInvoiceLines,
      user,
      password,
      host,
      database
    );
  }

  return {
    invoiceId,
    lines,
  };
}

module.exports = {
  getFullInvoice,
  createInvoiceLines,
};

//things to do
//1. update the id rightly to get the previous ID number and add by 1 (line item)
//2. the details should also populate well
