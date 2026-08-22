const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const MaintenanceHistory = sequelize.define('MaintenanceHistory', {
  EquipmentType: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  EquipmentNo: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  Material: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  MaintenanceTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  AcknowledgePerson: {
    type: DataTypes.STRING(50),
    allowNull: true
  }
}, {
  tableName: 'MaintenanceHistory',
  timestamps: false // Assuming the table doesn't have createdAt and updatedAt columns
});

module.exports = MaintenanceHistory;
