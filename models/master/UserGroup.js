const { DataTypes } = require('sequelize');
const { sequelize} = require('../../config/database');

const UserGroup = sequelize.define('UserGroup', {
  Id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      groupname: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      rights: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      isDelete: {
        type  : DataTypes.INTEGER,
        defaultValue: 0
      }
    }, {
    tableName: 'User_Group',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['id']
        },
        {
            fields: ['groupname']
        }
    ]
});

module.exports = UserGroup;
