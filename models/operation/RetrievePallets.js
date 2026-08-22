const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const RetrievePallets = sequelize.define('RetrievePallets', {
      ID: {
            type: DataTypes.BIGINT,
            primaryKey: true,
            allowNull: false,
            autoIncrement: true,
      },
      EquipmentNo: {
            type: DataTypes.BIGINT,
            allowNull: true,
            field: 'craneID'
      },
      PartNo: {
            type: DataTypes.STRING(200),
            allowNull: false,
            field: 'PartNo'   
      },
      PartName: {
            type: DataTypes.STRING(200),
            allowNull: false,
            field: 'PartName'
      },
      GroupCode: {
            type: DataTypes.STRING(200),
            allowNull: false,
            field: 'GroupCode'
      },
      GroupName: {
            type: DataTypes.STRING(200),
            allowNull: false,
            field: 'GroupName'
      },
      Type: {
            type:  DataTypes.STRING(50),
            allowNull: false ,
            field: 'Type'
      },
      RequiredQty:{
            type: DataTypes.REAL,
            allowNull: false,
            field: 'ReqQty'
      },
      UnloadFlag:{
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: 'False'
      },
      UpdatedDateTime:{
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue:sequelize.literal('GETDATE()')
      },
      UserName: {
            type: DataTypes.STRING(200),
            allowNull: false,
            field: 'user'
      },
      Priority: {
            type: DataTypes.STRING(20),
            allowNull: true ,
            field: 'Priority'
      },
      PickType: {
            type: DataTypes.STRING(50),
            allowNull: false ,
            field: 'PickType'
      },
      DeliveryStation: {
            type: DataTypes.STRING(50),
            allowNull: false,
            field: 'station'
      }
}, {
      // Other model options
      tableName: 'RetrievePallets', // Specify the table name if it's different from the model name
      timestamps: false // Set to true if your table has createdAt and updatedAt columns
});

module.exports = RetrievePallets;