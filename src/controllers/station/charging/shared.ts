/**
 * Validates and returns connector type from input
 * @param value Raw connector type value  
 * @returns Valid connector type or null
 */
const resolveConnectorType = (value: unknown) => {
  if (value === "CCS2" || value === "Type2" || value === "CHAdeMO") {
    return value;
  }

  return null;
};

export { resolveConnectorType };
