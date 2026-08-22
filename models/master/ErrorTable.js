const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/database');

const ErrorTable = sequelize.define('ErrorTable', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      EquipmentType: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      ErrorCode: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      ErrorDescription: {
        type: DataTypes.STRING(200),
        allowNull: false
      },
      UserName: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      UpdatedDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue:sequelize.literal('GETDATE()')
      },
    }, {
    tableName: 'ErrorTable',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['EquipmentType']
        },
        {
            fields: ['ErrorCode']
        }
    ]
});

module.exports = ErrorTable;
