program bobyqa_exmp
implicit none

logical :: parent_logical_array(20)
integer(4), allocatable :: locations(:)

locations = true_locations(parent_logical_array)
print *, "hello world"

contains

function true_locations(logical_array) result(location_array)
implicit none
logical, intent(in) :: logical_array(:)
integer(4), allocatable :: location_array(:)
integer(4) :: n, monotone_array(size(logical_array))
n = count(logical_array)
allocate(location_array(1:n))
location_array = pack(monotone_array, mask=logical_array)

end function true_locations
end program bobyqa_exmp
