from django.db import models


class FloorPlan(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    svg_data = models.TextField(blank=True, default="")
    width = models.PositiveIntegerField(default=1200)
    height = models.PositiveIntegerField(default=800)

    def __str__(self) -> str:
        return self.name


class Room(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True, null=True)
    floor_plan = models.ForeignKey(FloorPlan, related_name="rooms", on_delete=models.CASCADE)
    x = models.FloatField(default=40)
    y = models.FloatField(default=40)
    width = models.FloatField(default=320)
    height = models.FloatField(default=240)
    rotation = models.FloatField(default=0)
    z_index = models.IntegerField(default=-100)
    properties = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["z_index", "id"]

    def __str__(self) -> str:
        return self.name


class FloorPlanObject(models.Model):
    OBJECT_TYPES = [
        ("wall", "Wall"),
        ("door", "Door"),
        ("window", "Window"),
        ("stairs", "Stairs"),
        ("column", "Column"),
        ("radiator", "Radiator"),
        ("fireplace", "Fireplace"),
        ("boiler", "Boiler"),
        ("kitchen_counter", "Kitchen counter"),
        ("kitchen_island", "Kitchen island"),
        ("sink", "Sink"),
        ("oven", "Oven"),
        ("hob", "Hob"),
        ("fridge", "Fridge"),
        ("freezer", "Freezer"),
        ("dishwasher", "Dishwasher"),
        ("washing_machine", "Washing machine"),
        ("dryer", "Tumble dryer"),
        ("microwave", "Microwave"),
        ("toilet", "Toilet"),
        ("bath", "Bath"),
        ("shower", "Shower"),
        ("vanity", "Bathroom vanity"),
        ("bed", "Bed"),
        ("wardrobe", "Wardrobe"),
        ("chest_drawers", "Chest of drawers"),
        ("bedside_table", "Bedside table"),
        ("dresser", "Dresser"),
        ("sofa", "Sofa"),
        ("armchair", "Armchair"),
        ("coffee_table", "Coffee table"),
        ("side_table", "Side table"),
        ("dining_table", "Dining table"),
        ("dining_chair", "Dining chair"),
        ("desk", "Desk"),
        ("office_chair", "Office chair"),
        ("bookshelf", "Bookshelf"),
        ("cabinet", "Cabinet"),
        ("storage_unit", "Storage unit"),
        ("rug", "Rug"),
        ("plant", "Plant"),
        ("lamp", "Lamp"),
        ("tv_stand", "TV stand"),
        ("patio_table", "Patio table"),
        ("garden_chair", "Garden chair"),
        ("barbecue", "Barbecue"),
        ("appliance", "Appliance"),
        ("device", "Device"),
        ("label", "Label"),
    ]
    floor_plan = models.ForeignKey(
        FloorPlan,
        related_name="floorplan_objects",
        on_delete=models.CASCADE,
    )
    object_type = models.CharField(max_length=30, choices=OBJECT_TYPES)
    x = models.FloatField(default=0)
    y = models.FloatField(default=0)
    width = models.FloatField(default=100)
    height = models.FloatField(default=50)
    rotation = models.FloatField(default=0)
    z_index = models.IntegerField(default=0)
    properties = models.JSONField(default=dict, blank=True)
    device = models.ForeignKey(
        "core.Device",
        related_name="floorplan_objects",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    class Meta:
        ordering = ["z_index", "id"]

    def __str__(self) -> str:
        return f"{self.floor_plan}: {self.object_type} #{self.pk}"
