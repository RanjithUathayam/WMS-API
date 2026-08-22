// Define the Sequelize model for Tbl_PalletCall
const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database'); // Assuming you have set up your Sequelize connection

const Tbl_PalletCall = sequelize.define('Tbl_PalletCall', {
  Id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  Users: {
    type: DataTypes.STRING,
    allowNull: true
  },
  EquipmentNo: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  PalletId: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  CreatedDate: {
    type: DataTypes.DATE,
    defaultValue:sequelize.literal('GETDATE()'),
    allowNull: false
  },
  Type: {
    type: DataTypes.STRING(20),
    allowNull: false
  }
}, {
  tableName: 'Tbl_PalletCall',
  timestamps: false // Assuming there are no createdAt and updatedAt columns in the table
});

module.exports = Tbl_PalletCall;
