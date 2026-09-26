from sqlmodel import Session

from app.db.models import Item
from app.modules.items import repo as item_repo
from app.modules.items.schema import ItemCreate
from tests.utils.user import create_random_user
from tests.utils.utils import random_lower_string


def create_random_item(db: Session) -> Item:
    user = create_random_user(db)
    owner_id = user.id
    assert owner_id is not None
    title = random_lower_string()
    description = random_lower_string()
    item_in = ItemCreate(title=title, description=description)
    db_item = Item.model_validate(
        item_in, update={"owner_id": owner_id, "tenant_id": user.tenant_id}
    )
    return item_repo.create(session=db, item=db_item)
