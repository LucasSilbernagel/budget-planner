// `pg-native` is an optional peer dep we don't install. Vite would resolve it to a module
// that throws at evaluation, crashing every request, so it is aliased to this empty one.

export default {}
