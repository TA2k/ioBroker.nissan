module.exports = (data) => {
    const vehicleList = data.VehicleInfoList ? data.VehicleInfoList.vehicleInfo : data.vehicleInfo;
    const { vin: VIN, custom_sessionid } = vehicleList[0];
    return {
        VIN,
        custom_sessionid,
        DCMID: data.vehicle ? data.vehicle.profile.dcmId : vehicleList[0].dcmId,
        tz: data.CustomerInfo.Timezone,
        RegionCode: data.CustomerInfo.RegionCode,
        lg: data.CustomerInfo.Language,
    };
};
