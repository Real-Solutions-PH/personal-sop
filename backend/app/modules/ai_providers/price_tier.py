"""Which price tier an account is in, from its country.

The tiers come from the 2026-11 pricing study: tier 1 is full price (the US,
the UK, the euro area, Australia and every country not yet priced), tier 2
is Brazil and Mexico, tier 3 the Philippines, India and Indonesia. The
country -> tier map itself is a setting (``PRICE_TIER_COUNTRIES``) so a
re-priced country needs no release.

The country is the App Store storefront country when the phone has told us
(``UserProfile.storefront_country``), else the account's country. An account
has no country field of its own; its time zone stands in for it
(:data:`ZONE_COUNTRY`), which is the one location the account always carries.
"""

from app.core.config import settings

# IANA zones (and their legacy aliases) of the countries the pricing study
# priced below tier 1. A zone not listed resolves to no country, which is
# tier 1. A country added to PRICE_TIER_COUNTRIES needs its zones here.
ZONE_COUNTRY: dict[str, str] = {
    # Philippines
    "Asia/Manila": "PH",
    # India
    "Asia/Kolkata": "IN",
    "Asia/Calcutta": "IN",
    # Indonesia
    "Asia/Jakarta": "ID",
    "Asia/Pontianak": "ID",
    "Asia/Makassar": "ID",
    "Asia/Ujung_Pandang": "ID",
    "Asia/Jayapura": "ID",
    # Mexico
    "America/Mexico_City": "MX",
    "America/Cancun": "MX",
    "America/Merida": "MX",
    "America/Monterrey": "MX",
    "America/Matamoros": "MX",
    "America/Chihuahua": "MX",
    "America/Ciudad_Juarez": "MX",
    "America/Ojinaga": "MX",
    "America/Mazatlan": "MX",
    "America/Bahia_Banderas": "MX",
    "America/Hermosillo": "MX",
    "America/Tijuana": "MX",
    "America/Ensenada": "MX",
    "America/Santa_Isabel": "MX",
    "Mexico/BajaNorte": "MX",
    "Mexico/BajaSur": "MX",
    "Mexico/General": "MX",
    # Brazil
    "America/Sao_Paulo": "BR",
    "America/Noronha": "BR",
    "America/Belem": "BR",
    "America/Fortaleza": "BR",
    "America/Recife": "BR",
    "America/Araguaina": "BR",
    "America/Maceio": "BR",
    "America/Bahia": "BR",
    "America/Campo_Grande": "BR",
    "America/Cuiaba": "BR",
    "America/Santarem": "BR",
    "America/Porto_Velho": "BR",
    "America/Boa_Vista": "BR",
    "America/Manaus": "BR",
    "America/Eirunepe": "BR",
    "America/Rio_Branco": "BR",
    "America/Porto_Acre": "BR",
    "Brazil/Acre": "BR",
    "Brazil/DeNoronha": "BR",
    "Brazil/East": "BR",
    "Brazil/West": "BR",
}


def country_of(storefront: str | None, timezone: str | None) -> str | None:
    """The account's country for pricing: the storefront's, else the time
    zone's, else None."""
    if storefront and len(storefront.strip()) == 2:
        return storefront.strip().upper()
    if timezone:
        return ZONE_COUNTRY.get(timezone)
    return None


def tier_of(country: str | None) -> int:
    """The price tier of ``country``: 1 when unknown or not listed."""
    if not country:
        return 1
    return settings.price_tier_countries.get(country.upper(), 1)
