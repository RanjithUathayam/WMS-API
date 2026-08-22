const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const InvPalletDetailsTransaction = sequelize.define('InvPalletDetailsTransaction', {
    Id: {
        type: DataTypes.BIGINT,
        primaryKey: true
    },
    MainId: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    AisleNo: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    ShuttleID: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    BinID: {
        type: DataTypes.STRING(200),
        allowNull: false
    },
    ItemCode: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    ItemName: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    ItemGroup: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    Category: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Description: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Color: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    UOM: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Size: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Style: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    BinCapacity: {
        type: DataTypes.REAL,
        allowNull: true
    },
    Field1: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Field2: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Field3: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    Quantity: {
        type: DataTypes.INTEGER,
    },
    InQuantity: {
        type: DataTypes.INTEGER
    },
    OutQuantity: {
        type: DataTypes.INTEGER
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    BufferQty: {
        type: DataTypes.REAL,
        allowNull: true
    },
    PickType: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    FIFOType: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    UserName: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    PartWeight: {
        type: DataTypes.FLOAT,
        allowNull: true
    },
    GrossWeight: {
        type: DataTypes.FLOAT,
        allowNull: true
    },    
    Remarks: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'Inv_PalletDetails_Transaction',
    timestamps: false // If the table doesn't have createdAt and updatedAt fields
});

module.exports = InvPalletDetailsTransaction;
