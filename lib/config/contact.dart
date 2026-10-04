/// The operator's contact address, shown when the anonymous / unverified daily
/// takedown pool is exhausted (so a rights holder is never left without a way
/// to reach the operator).
///
/// Deliberately EMPTY: the owner sets it before building the release (see the
/// Deploy section's pre-release checklist). While it is empty the screen points
/// to the in-app お問い合わせ screen instead. Never invent an address here.
const String kOperatorContactEmail = '';
