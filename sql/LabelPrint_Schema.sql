IF OBJECT_ID('dbo.T_LABEL_NUMBER_SEQUENCE', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LABEL_NUMBER_SEQUENCE
    (
        SequenceID          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PrintDate           DATE            NOT NULL,
        LastRunningNumber   INT             NOT NULL DEFAULT 0,
        CreatedAt           DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedAt           DATETIME        NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LABEL_NUMBER_SEQUENCE_PRINTDATE' AND object_id = OBJECT_ID('dbo.T_LABEL_NUMBER_SEQUENCE'))
    CREATE UNIQUE INDEX UX_LABEL_NUMBER_SEQUENCE_PRINTDATE ON dbo.T_LABEL_NUMBER_SEQUENCE(PrintDate);
GO

IF OBJECT_ID('dbo.T_LABEL_TEMPLATE', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LABEL_TEMPLATE
    (
        TemplateID              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TemplateName            NVARCHAR(200)   NOT NULL,
        LabelWidth               DECIMAL(10,2)   NOT NULL DEFAULT 90,
        LabelHeight              DECIMAL(10,2)   NOT NULL DEFAULT 44,
        Gap                       DECIMAL(10,2)   NOT NULL DEFAULT 3,
        BrandSectionWidth        DECIMAL(5,2)    NOT NULL DEFAULT 37,   -- % of LabelWidth, left section
        CenterSectionWidth       DECIMAL(5,2)    NOT NULL DEFAULT 53,   -- % of LabelWidth, dynamic product data
        HologramSectionWidth     DECIMAL(5,2)    NOT NULL DEFAULT 10,   -- % of LabelWidth, right section
        Logo                     NVARCHAR(MAX)   NULL,                 -- URL or base64 reference
        BrandName                NVARCHAR(200)   NULL,
        Tagline                  NVARCHAR(300)   NULL,
        ManufacturerName         NVARCHAR(300)   NULL,
        ManufacturerAddress      NVARCHAR(500)   NULL,
        Contact                  NVARCHAR(100)   NULL,
        Email                    NVARCHAR(200)   NULL,
        Website                  NVARCHAR(200)   NULL,
        RegistrationNumber       NVARCHAR(100)   NULL,
        HologramImage            NVARCHAR(MAX)   NULL,                 -- URL or base64 reference
        IsActive                 BIT             NOT NULL DEFAULT 1,
        CreatedAt                DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedAt                DATETIME        NOT NULL DEFAULT GETDATE(),

        CONSTRAINT CK_LABEL_TEMPLATE_SECTIONS_SUM100 CHECK
            (BrandSectionWidth + CenterSectionWidth + HologramSectionWidth BETWEEN 99.5 AND 100.5)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.T_LABEL_TEMPLATE)
BEGIN
    INSERT INTO dbo.T_LABEL_TEMPLATE
        (TemplateName, LabelWidth, LabelHeight, Gap, BrandSectionWidth, CenterSectionWidth, HologramSectionWidth,
         BrandName, Tagline, ManufacturerName, ManufacturerAddress, Contact, Email, Website, RegistrationNumber, IsActive)
    VALUES
        ('Default Garment Label', 90, 44, 3, 37, 53, 10,
         'ARISER', 'FORMAL & CASUAL SHIRTS / TROUSERS', 'B and B Textile', NULL, NULL, NULL, NULL, NULL, 1);
END
GO

IF OBJECT_ID('dbo.T_LABEL_PRINT_CONFIG', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LABEL_PRINT_CONFIG
    (
        ConfigID        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PrinterName     NVARCHAR(200)   NOT NULL,
        Density         INT             NOT NULL,
        Speed           INT             NOT NULL,
        IsActive        BIT             NOT NULL DEFAULT 1,
        CreatedAt       DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedAt       DATETIME        NOT NULL DEFAULT GETDATE()
    );
END
ELSE IF COL_LENGTH('dbo.T_LABEL_PRINT_CONFIG', 'LabelWidth') IS NOT NULL
BEGIN
    -- Upgrading from v1, where physical size lived on the printer config instead of the template.
    ALTER TABLE dbo.T_LABEL_PRINT_CONFIG DROP COLUMN LabelWidth, LabelHeight, Gap;
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.T_LABEL_PRINT_CONFIG)
BEGIN
    INSERT INTO dbo.T_LABEL_PRINT_CONFIG (PrinterName, Density, Speed, IsActive)
    VALUES ('TSC TTP-244 Pro', 10, 2, 1);
END
GO

IF OBJECT_ID('dbo.T_LABEL_PRINT_JOB', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LABEL_PRINT_JOB
    (
        PrintJobID          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TemplateID           INT             NOT NULL,
        PrinterName          NVARCHAR(200)   NOT NULL,
        LabelWidth            DECIMAL(10,2)   NOT NULL,
        LabelHeight            DECIMAL(10,2)   NOT NULL,
        Gap                     DECIMAL(10,2)   NOT NULL,
        Density                 INT             NOT NULL,
        Speed                   INT             NOT NULL,
        LabelCount             INT             NOT NULL,
        Copies                  INT             NOT NULL,
        TotalPhysicalPrints    INT             NOT NULL,
        Status                  NVARCHAR(20)    NOT NULL DEFAULT 'Pending', -- Pending | Generated | Printing | Printed | Failed
        ErrorMessage            NVARCHAR(MAX)   NULL,
        CreatedBy               NVARCHAR(100)   NULL,
        CreatedAt               DATETIME        NOT NULL DEFAULT GETDATE(),
        StartedAt                DATETIME        NULL,
        CompletedAt              DATETIME        NULL,

        CONSTRAINT FK_LABEL_PRINT_JOB_TEMPLATE FOREIGN KEY (TemplateID)
            REFERENCES dbo.T_LABEL_TEMPLATE (TemplateID)
    );
END
ELSE BEGIN
    -- Upgrading from v1 field names/shape.
    IF COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'TemplateID') IS NULL
        ALTER TABLE dbo.T_LABEL_PRINT_JOB ADD TemplateID INT NULL;
    IF COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'TotalCopies') IS NOT NULL AND COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'TotalPhysicalPrints') IS NULL
        EXEC sp_rename 'dbo.T_LABEL_PRINT_JOB.TotalCopies', 'TotalPhysicalPrints', 'COLUMN';
    IF COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'PrintedAt') IS NOT NULL AND COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'CompletedAt') IS NULL
        EXEC sp_rename 'dbo.T_LABEL_PRINT_JOB.PrintedAt', 'CompletedAt', 'COLUMN';
    IF COL_LENGTH('dbo.T_LABEL_PRINT_JOB', 'StartedAt') IS NULL
        ALTER TABLE dbo.T_LABEL_PRINT_JOB ADD StartedAt DATETIME NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LABEL_PRINT_JOB_STATUS' AND object_id = OBJECT_ID('dbo.T_LABEL_PRINT_JOB'))
    CREATE INDEX IX_LABEL_PRINT_JOB_STATUS ON dbo.T_LABEL_PRINT_JOB(Status);
GO

-- v1 name; renamed below to T_LABEL_RECORD to match this feature's naming going forward.
IF OBJECT_ID('dbo.T_LABEL_PRINT_LABEL', 'U') IS NOT NULL AND OBJECT_ID('dbo.T_LABEL_RECORD', 'U') IS NULL
    EXEC sp_rename 'dbo.T_LABEL_PRINT_LABEL', 'T_LABEL_RECORD';
GO

IF OBJECT_ID('dbo.T_LABEL_RECORD', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.T_LABEL_RECORD
    (
        LabelID         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        PrintJobID      INT             NOT NULL,
        LabelNumber     NVARCHAR(30)    NOT NULL,
        QRValue         NVARCHAR(50)    NOT NULL,
        ItemID          NVARCHAR(100)   NOT NULL,
        SKU             NVARCHAR(100)   NOT NULL,
        ProductName     NVARCHAR(300)   NOT NULL,
        StyleNo         NVARCHAR(100)   NULL,
        Customer        NVARCHAR(200)   NULL,
        Size            NVARCHAR(50)    NULL,
        Color           NVARCHAR(100)   NULL,
        MRP             DECIMAL(18,2)   NULL,
        Copies          INT             NOT NULL,
        Status          NVARCHAR(20)    NOT NULL DEFAULT 'Pending', -- Pending | Generated | Printing | Printed | Failed
        ErrorMessage    NVARCHAR(MAX)   NULL,
        CreatedAt       DATETIME        NOT NULL DEFAULT GETDATE(),
        PrintedAt       DATETIME        NULL,
        FailedAt        DATETIME        NULL,

        CONSTRAINT FK_LABEL_RECORD_JOB FOREIGN KEY (PrintJobID)
            REFERENCES dbo.T_LABEL_PRINT_JOB (PrintJobID)
    );
END
ELSE BEGIN
    -- Upgrading from v1 field names (ItemCode/ItemName -> SKU/ProductName) and new columns.
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'LabelLineID') IS NOT NULL AND COL_LENGTH('dbo.T_LABEL_RECORD', 'LabelID') IS NULL
        EXEC sp_rename 'dbo.T_LABEL_RECORD.LabelLineID', 'LabelID', 'COLUMN';
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'ItemCode') IS NOT NULL AND COL_LENGTH('dbo.T_LABEL_RECORD', 'SKU') IS NULL
        EXEC sp_rename 'dbo.T_LABEL_RECORD.ItemCode', 'SKU', 'COLUMN';
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'ItemName') IS NOT NULL AND COL_LENGTH('dbo.T_LABEL_RECORD', 'ProductName') IS NULL
        EXEC sp_rename 'dbo.T_LABEL_RECORD.ItemName', 'ProductName', 'COLUMN';
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'ItemID') IS NULL
        ALTER TABLE dbo.T_LABEL_RECORD ADD ItemID NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'StyleNo') IS NULL
        ALTER TABLE dbo.T_LABEL_RECORD ADD StyleNo NVARCHAR(100) NULL;
    IF COL_LENGTH('dbo.T_LABEL_RECORD', 'Customer') IS NULL
        ALTER TABLE dbo.T_LABEL_RECORD ADD Customer NVARCHAR(200) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LABEL_RECORD_LABELNUMBER' AND object_id = OBJECT_ID('dbo.T_LABEL_RECORD'))
    CREATE UNIQUE INDEX UX_LABEL_RECORD_LABELNUMBER ON dbo.T_LABEL_RECORD(LabelNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_LABEL_RECORD_QRVALUE' AND object_id = OBJECT_ID('dbo.T_LABEL_RECORD'))
    CREATE UNIQUE INDEX UX_LABEL_RECORD_QRVALUE ON dbo.T_LABEL_RECORD(QRValue);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_LABEL_RECORD_JOB' AND object_id = OBJECT_ID('dbo.T_LABEL_RECORD'))
    CREATE INDEX IX_LABEL_RECORD_JOB ON dbo.T_LABEL_RECORD(PrintJobID);
GO
