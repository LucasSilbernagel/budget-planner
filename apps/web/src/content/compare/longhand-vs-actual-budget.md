Actual Budget is a free, open-source envelope budget. It began as a paid app by James
Long, was open-sourced in 2022, and is now maintained by a community: about 29,000 stars
on GitHub, a release most months (v26.10.0 on 2 October 2026), and support through
Discord and GitHub rather than a company. You import or type every transaction, assign
money to categories, and the app keeps a running picture of where it went.

The catch is the word "self-hosted". Actual stores your budget locally, and to use it on
more than one device you run its sync server yourself: Docker on a machine you own, a
rented container such as PikaPods (from about $2 a month), or the desktop app, which
bundles the server for a single computer. Actual's own documentation says the browser-only
version is "not recommended for long-term use", that the official mobile apps are
deprecated, and that a phone needs a server to talk to. Bank feeds are optional, cost
extra (SimpleFIN is $1.50 a month or $15 a year in North America), and also need that
server. For someone comfortable with Docker this is a weekend; for everyone else it is
the reason they never start.

Longhand Budget is a different kind of tool. It does not record transactions or import
anything. You enter your income, bills, savings, debts and what you own, each with its
frequency, and it shows where those figures lead: net worth, savings goals, a retirement
projection, and premium what-if forecasts you can save and reload. There is nothing to
host and no server password to lose. The free tier runs entirely in your browser. The
premium tier adds sync, hosted in Germany by an EU provider, so the privacy question is
answered by the vendor rather than by your own infrastructure.
