const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const BinningComplete = sequelize.define('T_BINCOMPLETE', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    BinID: {
        type: DataTypes.STRING,
        allowNull: true
    },
    GRNNo: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    GRNType:{
        type: DataTypes.STRING,
        allowNull: false
    },
    DocNo: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    ItemName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    ItemGroup: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Quantity: {
        type: DataTypes.STRING,
        allowNull: true
    },
    BinningStatus:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Pending'
    },
    CreatedDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue:sequelize.literal('GETDATE()')
    },
    CreatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: true
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    isDelete: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 0
    },
    ItemStatus: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Pending'
    },
    scannedItem:{
        type: DataTypes.STRING,
        allowNull: true
    },
    WhsCode: {
        type: DataTypes.STRING,
        allowNull: true
    },
}, {
    tableName: 'T_BIN_COMPLETE',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['BinID']
        },
        {
            fields: ['GRNNo']
        },
        {
            fields: ['ItemCode']
        } 
    ]
});

module.exports = BinningComplete;