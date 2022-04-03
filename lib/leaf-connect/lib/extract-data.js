module.exports = data => {
  const { vin: VIN, custom_sessionid } = data.VehicleInfoList.vehicleInfo[0]
  return {
    VIN,
    custom_sessionid,
    DCMID: data.vehicle.profile.dcmId,
    tz: data.CustomerInfo.Timezone,
    RegionCode: data.CustomerInfo.RegionCode,
    lg: data.CustomerInfo.Language
  }
}
