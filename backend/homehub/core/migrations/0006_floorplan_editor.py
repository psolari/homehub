from django.db import migrations, models


OBJECT_TYPES = [
    ("wall", "Wall"),
    ("door", "Door"),
    ("window", "Window"),
    ("stairs", "Stairs"),
    ("column", "Column"),
    ("radiator", "Radiator"),
    ("fireplace", "Fireplace"),
    ("kitchen_counter", "Kitchen counter"),
    ("kitchen_island", "Kitchen island"),
    ("sink", "Sink"),
    ("toilet", "Toilet"),
    ("bath", "Bath"),
    ("shower", "Shower"),
    ("bed", "Bed"),
    ("wardrobe", "Wardrobe"),
    ("chest_drawers", "Chest of drawers"),
    ("bedside_table", "Bedside table"),
    ("sofa", "Sofa"),
    ("armchair", "Armchair"),
    ("coffee_table", "Coffee table"),
    ("dining_table", "Dining table"),
    ("dining_chair", "Dining chair"),
    ("desk", "Desk"),
    ("office_chair", "Office chair"),
    ("bookshelf", "Bookshelf"),
    ("cabinet", "Cabinet"),
    ("rug", "Rug"),
    ("plant", "Plant"),
    ("lamp", "Lamp"),
    ("tv_stand", "TV stand"),
    ("appliance", "Appliance"),
    ("device", "Device"),
    ("label", "Label"),
]


class Migration(migrations.Migration):
    dependencies = [("core", "0005_homehub_foundation")]

    operations = [
        migrations.AddField(
            model_name="room",
            name="x",
            field=models.FloatField(default=40),
        ),
        migrations.AddField(
            model_name="room",
            name="y",
            field=models.FloatField(default=40),
        ),
        migrations.AddField(
            model_name="room",
            name="width",
            field=models.FloatField(default=320),
        ),
        migrations.AddField(
            model_name="room",
            name="height",
            field=models.FloatField(default=240),
        ),
        migrations.AddField(
            model_name="room",
            name="rotation",
            field=models.FloatField(default=0),
        ),
        migrations.AddField(
            model_name="room",
            name="z_index",
            field=models.IntegerField(default=-100),
        ),
        migrations.AddField(
            model_name="room",
            name="properties",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterModelOptions(
            name="room",
            options={"ordering": ["z_index", "id"]},
        ),
        migrations.AlterField(
            model_name="floorplanobject",
            name="object_type",
            field=models.CharField(choices=OBJECT_TYPES, max_length=30),
        ),
    ]
