device_schema = {
    "tv": {
        "generic": {
            "display_name": "Smart TV",
        },
        "lg": {
            "display_name": "LG TV",
            "fields": [],
        },
        "samsung": {
            "display_name": "Samsung TV",
            "fields": [
                {
                    "name": "token",
                    "display_name": "Token",
                    "type": "string",
                    "required": False,
                    "description": "Token for the Samsung TV",
                    "hidden": True,
                },
            ],
        },
    },
    "appliance": {
        "generic": {
            "display_name": "Appliance",
        },
        "roomba": {
            "display_name": "Roomba",
            "fields": [],
        },
    },
    "speaker": {
        "generic": {
            "display_name": "Speaker",
        },
        "sonos": {
            "display_name": "Sonos",
            "fields": [],
        },
        "google_home": {
            "display_name": "Google Home",
            "fields": [],
        },
    },
}
