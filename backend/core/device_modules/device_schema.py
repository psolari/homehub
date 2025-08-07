device_schema = {
    "lg_tv": {
        "display_name": "LG TV",
        "fields": [],
    },
    "samsung_tv": {
        "display_name": "Samsung TV",
        "fields": [
            {
                "name": "token",
                "type": "string",
                "required": False,
                "description": "Token for the Samsung TV",
                "hidden": True,
            },
        ],
    },
    "roomba": {
        "display_name": "Roomba",
        "fields": [],
    },
}
