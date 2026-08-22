const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const AlarmHistory = sequelize.define('AlarmHistory', {
    Id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    User: {
      type: DataTypes.STRING,
      allowNull: false
    },
    AlarmDateTime: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue:sequelize.literal('GETDATE()')
    },
    EquipmentNo: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    ErrorCode: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    AlarmText: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    AlarmAckTime: {
      type: DataTypes.DATE,
      allowNull:false
    },
    IsReset: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    EquipmentType: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'AlarmHistory',
    timestamps: false // Set to true if the table has createdAt and updatedAt fields
  });
  
  
  // Export the model for use in other parts of the application
  module.exports = AlarmHistory;