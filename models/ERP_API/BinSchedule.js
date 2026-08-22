const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ERPSchedule = sequelize.define('ERPSchedule', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true
    },
    OrderNo: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    DocEntry: {
        type: DataTypes.STRING,
        allowNull: false
    },
    Type: {
        type: DataTypes.STRING,
        allowNull: true
    },
    ItemCode: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    ItemName:{
        type: DataTypes.STRING,
        allowNull: false
    },
    Quantity: {
        type: DataTypes.BIGINT,
        allowNull: true
    },
    Station:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    Floor:{
        type: DataTypes.STRING,
        allowNull: true,
    },
    ScheduleDateTime:{
        type: DataTypes.DATE,
        allowNull: false,
    },
    isDelete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
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
        allowNull: true,
    },
    UpdatedBy: {
        type: DataTypes.STRING,
        allowNull: true
    },
    Status:{
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue:'G'
    },
    ReqType:{
        type: DataTypes.STRING,
        allowNull: false
    },
    SequenceNo:{
        type: DataTypes.REAL,
        allowNull: true
    }
}, {
    tableName: 'ERP_Schedule',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['OrderNo']
        }
    ]
});

module.exports = ERPSchedule;