const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const RightsList = sequelize.define('RightsList', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  module: {
    type: DataTypes.STRING,
    allowNull: false
  },
  sub_module: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lists: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  creates: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  modifies: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  deletes: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  exports: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  pattern: {
    type: DataTypes.STRING,
    allowNull: false
  },
  IsDelete: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: sequelize.literal('GETDATE()')
  }
}, {
  tableName: 'RightsMenuList',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['id']
    },
    {
      fields: ['module']
    },
    {
      fields: ['lists']
    },
    {
      fields: ['creates']
    },
    {
      fields: ['modifies']
    },
    {
      fields: ['deletes']
    },
    {
      fields: ['exports']
    },
    {
      fields: ['sub_module']
    },
    {
      fields: ['pattern']
    },
    {
      fields: ['IsDelete']
    }
  ]
});

module.exports = RightsList;
